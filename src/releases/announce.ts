import { config } from "../config.js";
import { escapeHtml } from "../utils/html.js";
import { link } from "../github/formatters.js";
import {
  fetchCommitMessages,
  fetchLatestRelease,
  fetchRelease,
  githubGet,
  GitHubFetchError,
  type GitHubRelease,
} from "./github.js";
import { findProductByRepo, type Product } from "../products.js";
import { getState, isAnnounced, markAnnounced, updateState } from "../store.js";
import { bot } from "../telegram/client.js";

export { GitHubFetchError, type GitHubRelease };

// Telegram caps messages at 4096 characters; leave room for entity expansion.
export const ANNOUNCEMENT_MAX_LENGTH = 3800;
const MAX_CHANGELOG_LINES = 12;
// Telegram allows about 30 messages per second; stay well below it for DMs.
const DM_DELAY_MS = 60;

export type InlineKeyboard = { inline_keyboard: Array<Array<{ text: string; url: string }>> };

export type AnnounceResult =
  | { status: "announced"; messageId: number; subscribers: number }
  | { status: "duplicate" }
  | { status: "skipped"; reason: string };

export type SendFn = (
  chatId: string | number,
  text: string,
  threadId: number | undefined,
  replyMarkup: InlineKeyboard,
) => Promise<number>;

export type AnnounceDeps = {
  fetchFn?: typeof fetch;
  send?: SendFn;
  pin?: (chatId: string | number, messageId: number) => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
};

export function products(): Product[] {
  return config.announce?.products ?? [];
}

export function productForRepo(repo: string | undefined): Product | undefined {
  return findProductByRepo(products(), repo);
}

export function normalizeVersion(tagOrVersion: string): string {
  return tagOrVersion.replace(/^v/i, "");
}

export function announceKey(product: Product, version: string): string {
  return `${product.id}@${normalizeVersion(version)}`;
}

// ── Changelog ─────────────────────────────────────────────────────────

// Conventional-commit subjects worth telling users about.
const USER_FACING = /^(feat|fix|perf)(\([^)]*\))?!?:\s*(.+)$/i;

export function changelogFromCommits(messages: string[]): string[] {
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const message of messages) {
    const subject = message.split("\n")[0].trim();
    const match = USER_FACING.exec(subject);
    if (!match) continue;
    const kind = match[1].toLowerCase();
    const text = match[3].trim();
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const prefix = kind === "feat" ? "New" : kind === "fix" ? "Fixed" : "Faster";
    lines.push(`${prefix}: ${text.charAt(0).toUpperCase()}${text.slice(1)}`);
  }
  return lines;
}

// The published release just before `release`, used as the changelog base.
async function fetchPreviousTag(repo: string, release: GitHubRelease, fetchFn: typeof fetch) {
  const releases = await githubGet<GitHubRelease[]>(`/repos/${repo}/releases?per_page=20`, fetchFn);
  if (!releases || !release.published_at) return null;
  const current = Date.parse(release.published_at);
  const older = releases
    .filter((r) => !r.draft && !r.prerelease && r.tag_name !== release.tag_name && r.published_at)
    .filter((r) => Date.parse(r.published_at as string) < current)
    .sort((a, b) => Date.parse(b.published_at as string) - Date.parse(a.published_at as string));
  return older[0]?.tag_name ?? null;
}

async function releaseChangelog(repo: string, release: GitHubRelease, fetchFn: typeof fetch) {
  try {
    const previous = await fetchPreviousTag(repo, release, fetchFn);
    if (!previous) return [];
    return changelogFromCommits(await fetchCommitMessages(repo, previous, release.tag_name, fetchFn));
  } catch (error) {
    // A changelog is nice to have; never block the announcement on it.
    console.warn(`[announce] changelog unavailable for ${repo}@${release.tag_name}:`, error);
    return [];
  }
}

// ── Formatting ────────────────────────────────────────────────────────

const PLATFORM_BUTTONS: Array<{ label: string; match: (name: string) => boolean }> = [
  { label: "macOS (Apple silicon)", match: (n) => n.endsWith(".dmg") && /aarch64|arm64/.test(n) },
  { label: "macOS (Intel)", match: (n) => n.endsWith(".dmg") && !/aarch64|arm64/.test(n) },
  { label: "Windows", match: (n) => n.endsWith("-setup.exe") },
  { label: "Linux .deb", match: (n) => n.endsWith(".deb") },
  { label: "Linux AppImage", match: (n) => n.endsWith(".AppImage") },
  { label: "Linux .rpm", match: (n) => n.endsWith(".rpm") },
];

export function hasInstallers(release: GitHubRelease): boolean {
  return release.assets.some((a) => PLATFORM_BUTTONS.some((p) => p.match(a.name)));
}

/** Per-platform download buttons, two per row, then the page/notes row. */
export function downloadButtons(
  release: GitHubRelease,
  pageUrl: string | undefined,
  pageLabel = "Download page",
): InlineKeyboard {
  const platform = PLATFORM_BUTTONS.flatMap(({ label, match }) => {
    const asset = release.assets.find((a) => match(a.name));
    return asset ? [{ text: label, url: asset.browser_download_url }] : [];
  });
  const rows: InlineKeyboard["inline_keyboard"] = [];
  for (let i = 0; i < platform.length; i += 2) rows.push(platform.slice(i, i + 2));
  const footer = [{ text: "Release notes", url: release.html_url }];
  if (pageUrl) footer.unshift({ text: pageLabel, url: pageUrl });
  rows.push(footer);
  return { inline_keyboard: rows };
}

function changelogBlock(changelog: string[]): string {
  if (changelog.length === 0) return "";
  const shown = changelog.slice(0, MAX_CHANGELOG_LINES);
  const lines = shown.map((line) => `• ${escapeHtml(line)}`);
  const hidden = changelog.length - shown.length;
  if (hidden > 0) lines.push(`…and ${hidden} more`);
  return `<b>What's new</b>\n${lines.join("\n")}`;
}

/** Joins sections; drops the changelog if the message would be too long. */
function compose(header: string, changelog: string[], footer: string[]): string {
  const parts = (withChangelog: boolean) =>
    [header, withChangelog ? changelogBlock(changelog) : "", ...footer].filter(Boolean).join("\n\n");
  const full = parts(true);
  return full.length <= ANNOUNCEMENT_MAX_LENGTH ? full : parts(false);
}

export function formatReleaseAnnouncement(
  product: Product,
  release: GitHubRelease,
  changelog: string[],
): string {
  const header = `🚀 <b>${escapeHtml(`${product.name} ${release.tag_name}`)} is out</b>`;
  const footer: string[] = [];
  if (hasInstallers(release)) {
    footer.push("Already installed? The app updates itself: accept the prompt and restart.\nNew here? Pick your system below.");
  }
  if (product.install) footer.push(`Install or upgrade: <code>${escapeHtml(product.install)}</code>`);
  footer.push(link(release.html_url, "Full release notes"));
  return compose(header, changelog, footer);
}

export function registryPageUrl(product: Product): string | undefined {
  if (product.crate) return `https://crates.io/crates/${product.crate}`;
  if (product.npm) return `https://www.npmjs.com/package/${product.npm}`;
  return undefined;
}

export function formatRegistryAnnouncement(product: Product, version: string): string {
  const header = `🚀 <b>${escapeHtml(`${product.name} ${normalizeVersion(version)}`)} is out</b>`;
  const footer: string[] = [];
  if (product.install) footer.push(`Install or upgrade: <code>${escapeHtml(product.install)}</code>`);
  const page = registryPageUrl(product);
  if (page) footer.push(link(page, product.crate ? "crates.io" : "npm"));
  return compose(header, [], footer);
}

export function formatWebDeployAnnouncement(product: Product, changelog: string[]): string {
  const header = `🌐 <b>${escapeHtml(product.name)} updated</b>`;
  const footer = product.url ? [`Live now at ${link(product.url, product.url.replace(/^https?:\/\//, ""))}. Refresh to get it.`] : [];
  return compose(header, changelog, footer);
}

// ── Delivery ──────────────────────────────────────────────────────────

const defaultSend: SendFn = async (chatId, text, threadId, replyMarkup) => {
  const message = await bot.api.sendMessage(chatId, text, {
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    message_thread_id: threadId,
    reply_markup: replyMarkup.inline_keyboard.length > 0 ? replyMarkup : undefined,
  });
  return message.message_id;
};

const defaultPin: NonNullable<AnnounceDeps["pin"]> = async (chatId, messageId) => {
  await bot.api.pinChatMessage(chatId, messageId, { disable_notification: false });
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function subscribersOf(productId: string): string[] {
  return Object.entries(getState().subscriptions)
    .filter(([, ids]) => ids.includes(productId))
    .map(([chatId]) => chatId);
}

// 403 = the user blocked the bot or deleted their account; 400 "chat not found".
function isGoneError(error: unknown): boolean {
  const code = (error as { error_code?: number })?.error_code;
  const text = String((error as { description?: string })?.description ?? "");
  return code === 403 || (code === 400 && /chat not found/i.test(text));
}

/** Sends a post to every DM subscriber of `productId`; drops chats that are gone. */
export async function sendToSubscribers(
  productId: string,
  text: string,
  keyboard: InlineKeyboard,
  deps: AnnounceDeps = {},
): Promise<number> {
  const send = deps.send ?? defaultSend;
  const sleep = deps.sleep ?? defaultSleep;
  let delivered = 0;
  const gone: string[] = [];
  for (const chatId of subscribersOf(productId)) {
    try {
      await send(chatId, text, undefined, keyboard);
      delivered += 1;
    } catch (error) {
      if (isGoneError(error)) gone.push(chatId);
      else console.warn(`[announce] DM to ${chatId} failed:`, error);
    }
    await sleep(DM_DELAY_MS);
  }
  if (gone.length > 0) {
    await updateState((s) => {
      for (const chatId of gone) delete s.subscriptions[chatId];
    });
  }
  return delivered;
}

// The release workflow and the webhook trigger an announcement for the same
// version seconds apart; share the in-flight run so only one posts.
const inFlight = new Map<string, Promise<AnnounceResult>>();

function once(key: string, run: () => Promise<AnnounceResult>): Promise<AnnounceResult> {
  if (isAnnounced(key)) return Promise.resolve({ status: "duplicate" });
  const pending = inFlight.get(key);
  if (pending) return pending.then(() => ({ status: "duplicate" }) as AnnounceResult);
  const promise = run().finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

/** Posts to the announcements chat, records it, pins it, then DMs subscribers. */
async function publish(
  key: string,
  product: Product,
  text: string,
  keyboard: InlineKeyboard,
  source: string,
  deps: AnnounceDeps,
): Promise<AnnounceResult> {
  const announce = config.announce;
  if (!announce) return { status: "skipped", reason: "announcements not configured" };
  const messageId = await (deps.send ?? defaultSend)(announce.chatId, text, announce.threadId, keyboard);
  await markAnnounced(key);
  console.log(`[announce] posted ${key} (via ${source}), message ${messageId}`);

  if (announce.pin) {
    try {
      await (deps.pin ?? defaultPin)(announce.chatId, messageId);
    } catch (error) {
      // Pinning needs admin rights; a missing right must not fail the post.
      console.warn(`[announce] could not pin ${key}:`, error);
    }
  }
  const subscribers = await sendToSubscribers(product.id, text, keyboard, deps);
  return { status: "announced", messageId, subscribers };
}

// ── Entry points ──────────────────────────────────────────────────────

/**
 * Announces a GitHub release of `product` once. Throws only when GitHub or
 * Telegram fail, so the HTTP endpoint can ask the caller to retry.
 */
export function announceRelease(
  product: Product,
  tag: string,
  source: string,
  deps: AnnounceDeps = {},
): Promise<AnnounceResult> {
  return once(announceKey(product, tag), async () => {
    const announce = config.announce;
    if (!announce) return { status: "skipped", reason: "announcements not configured" };
    const fetchFn = deps.fetchFn ?? fetch;
    const release = await fetchRelease(product.repo, tag, fetchFn);
    if (!release) throw new GitHubFetchError(`No release found for ${product.repo}@${tag}`);
    if (release.draft) return { status: "skipped", reason: "release is a draft" };
    if (release.prerelease && !announce.includePrereleases) {
      return { status: "skipped", reason: "release is a prerelease" };
    }
    const changelog = await releaseChangelog(product.repo, release, fetchFn);
    const text = formatReleaseAnnouncement(product, release, changelog);
    const keyboard = downloadButtons(release, product.url, product.trigger === "workflow" ? "Download page" : "Website");
    return publish(announceKey(product, tag), product, text, keyboard, source, deps);
  });
}

/**
 * Announces a version seen on crates.io or npm. Uses the matching GitHub
 * release (with changelog) when there is one; otherwise a short post.
 */
export function announceRegistryVersion(
  product: Product,
  version: string,
  source: string,
  deps: AnnounceDeps = {},
): Promise<AnnounceResult> {
  const key = announceKey(product, version);
  if (isAnnounced(key)) return Promise.resolve({ status: "duplicate" });
  return (async () => {
    const fetchFn = deps.fetchFn ?? fetch;
    for (const tag of [`v${normalizeVersion(version)}`, normalizeVersion(version)]) {
      try {
        if (await fetchRelease(product.repo, tag, fetchFn)) return announceRelease(product, tag, source, deps);
      } catch (error) {
        console.warn(`[announce] could not look up ${product.repo}@${tag}:`, error);
        break;
      }
    }
    return once(key, async () => {
      const page = registryPageUrl(product);
      const keyboard: InlineKeyboard = { inline_keyboard: page ? [[{ text: "View package", url: page }]] : [] };
      return publish(key, product, formatRegistryAnnouncement(product, version), keyboard, source, deps);
    });
  })();
}

/**
 * Announces a production web deploy when user-facing commits shipped since
 * the last one. The first deploy seen is recorded without a post.
 */
export function announceWebDeploy(
  product: Product,
  sha: string,
  source: string,
  deps: AnnounceDeps = {},
): Promise<AnnounceResult> {
  const key = `${product.id}@${sha.slice(0, 12)}`;
  return once(key, async () => {
    const previous = getState().webDeploySha[product.id];
    if (previous === sha) return { status: "duplicate" };
    if (!previous) {
      await updateState((s) => void (s.webDeploySha[product.id] = sha));
      return { status: "skipped", reason: "first deploy seen; recorded as the baseline" };
    }
    const fetchFn = deps.fetchFn ?? fetch;
    const changelog = changelogFromCommits(await fetchCommitMessages(product.repo, previous, sha, fetchFn));
    await updateState((s) => void (s.webDeploySha[product.id] = sha));
    if (changelog.length === 0) return { status: "skipped", reason: "no user-facing changes" };
    const keyboard: InlineKeyboard = {
      inline_keyboard: product.url ? [[{ text: `Open ${product.name}`, url: product.url }]] : [],
    };
    return publish(key, product, formatWebDeployAnnouncement(product, changelog), keyboard, source, deps);
  });
}

/**
 * Picks the release tag a finished release workflow produced. Tag-triggered
 * and tag-dispatched runs carry the tag in `head_branch`; otherwise fall back
 * to the latest release, only if it was published after the run started.
 */
export async function resolveTagForRun(
  repo: string,
  run: { head_branch: string | null; run_started_at?: string | null; created_at?: string },
  fetchFn: typeof fetch = fetch,
): Promise<string | null> {
  if (run.head_branch) {
    const release = await fetchRelease(repo, run.head_branch, fetchFn);
    if (release) return release.tag_name;
  }
  const latest = await fetchLatestRelease(repo, fetchFn);
  const started = Date.parse(run.run_started_at ?? run.created_at ?? "");
  if (latest?.published_at && !Number.isNaN(started) && Date.parse(latest.published_at) >= started) {
    return latest.tag_name;
  }
  return null;
}
