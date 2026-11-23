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
import { getState, isAnnounced, markAnnounced, updateState, type PendingUpdate } from "../store.js";
import { bot } from "../telegram/client.js";

export { GitHubFetchError, type GitHubRelease };

// Telegram caps messages at 4096 characters; leave room for entity expansion.
export const ANNOUNCEMENT_MAX_LENGTH = 3800;
const MAX_CHANGELOG_LINES = 12;
// Telegram allows about 30 messages per second; stay well below it for DMs.
const DM_DELAY_MS = 60;
const NO_KEYBOARD: InlineKeyboard = { inline_keyboard: [] };

export type InlineKeyboard = { inline_keyboard: Array<Array<{ text: string; url: string }>> };

export type AnnounceResult =
  | { status: "queued" }
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

export function registryPageUrl(product: Product): string | undefined {
  if (product.crate) return `https://crates.io/crates/${product.crate}`;
  if (product.npm) return `https://www.npmjs.com/package/${product.npm}`;
  return undefined;
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

/** Queues a release or deploy for the weekly post. Nothing is sent here. */
async function queueUpdate(
  key: string,
  product: Product,
  update: Pick<PendingUpdate, "title" | "changelog" | "link">,
  source: string,
): Promise<AnnounceResult> {
  if (!config.announce) return { status: "skipped", reason: "announcements not configured" };
  await updateState((s) => {
    s.pendingUpdates.push({
      key,
      productId: product.id,
      productName: product.name,
      install: product.install,
      at: new Date().toISOString(),
      ...update,
    });
  });
  await markAnnounced(key);
  console.log(`[announce] queued ${key} for the weekly update (via ${source})`);
  return { status: "queued" };
}

/** Formats queued updates into one message, grouped by product. Null when there is nothing to say. */
export function formatAppUpdates(items: PendingUpdate[]): string | null {
  if (items.length === 0) return null;
  const groups = new Map<string, PendingUpdate[]>();
  for (const item of items) groups.set(item.productId, [...(groups.get(item.productId) ?? []), item]);

  const header = `📦 <b>Txio app updates</b>\n${items.length} update${items.length === 1 ? "" : "s"}`;
  const sections = [...groups.values()].map((group) => {
    const lines = [`<b>${escapeHtml(group[0].productName)}</b>`];
    for (const item of group) {
      const title = item.link ? link(item.link.url, item.title) : escapeHtml(item.title);
      lines.push(`🚀 ${title}`);
      for (const line of item.changelog.slice(0, MAX_CHANGELOG_LINES)) lines.push(`• ${escapeHtml(line)}`);
      const hidden = item.changelog.length - MAX_CHANGELOG_LINES;
      if (hidden > 0) lines.push(`…and ${hidden} more`);
    }
    const install = group.find((item) => item.install)?.install;
    if (install) lines.push(`Install or upgrade: <code>${escapeHtml(install)}</code>`);
    return lines.join("\n");
  });

  // Drop whole product sections from the end until the message fits.
  const trimmed = (kept: string[]) => [header, ...kept, "…(more updates trimmed)"].join("\n\n");
  let text = [header, ...sections].join("\n\n");
  while (text.length > ANNOUNCEMENT_MAX_LENGTH && sections.length > 1) {
    sections.pop();
    text = trimmed(sections);
  }
  return text.slice(0, ANNOUNCEMENT_MAX_LENGTH);
}

/** DMs each subscriber only the updates for the products they follow. */
async function sendDigestToSubscribers(pending: PendingUpdate[], deps: AnnounceDeps): Promise<number> {
  const send = deps.send ?? defaultSend;
  const sleep = deps.sleep ?? defaultSleep;
  let delivered = 0;
  const gone: string[] = [];
  for (const [chatId, productIds] of Object.entries(getState().subscriptions)) {
    const text = formatAppUpdates(pending.filter((item) => productIds.includes(item.productId)));
    if (!text) continue;
    try {
      await send(chatId, text, undefined, NO_KEYBOARD);
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

/**
 * Posts every queued update as one weekly message to the announcements
 * chat, then DMs subscribers. Posted items leave the queue; items queued
 * while posting stay for next week. Returns false when nothing was queued.
 */
export async function postAppUpdates(deps: AnnounceDeps = {}): Promise<boolean> {
  const announce = config.announce;
  if (!announce) return false;
  const pending = [...getState().pendingUpdates];
  const text = formatAppUpdates(pending);
  if (!text) return false;

  const messageId = await (deps.send ?? defaultSend)(announce.chatId, text, announce.threadId, NO_KEYBOARD);
  if (announce.pin) {
    try {
      await (deps.pin ?? defaultPin)(announce.chatId, messageId);
    } catch (error) {
      console.warn("[announce] could not pin the weekly update:", error);
    }
  }
  const subscribers = await sendDigestToSubscribers(pending, deps);

  const posted = new Set(pending.map((item) => item.key));
  await updateState((s) => {
    s.pendingUpdates = s.pendingUpdates.filter((item) => !posted.has(item.key));
  });
  console.log(`[announce] posted ${pending.length} app update(s), message ${messageId}, ${subscribers} DM(s)`);
  return true;
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
    return queueUpdate(
      announceKey(product, tag),
      product,
      { title: `${product.name} ${release.tag_name}`, changelog, link: { url: release.html_url, text: "Release notes" } },
      source,
    );
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
      return queueUpdate(
        key,
        product,
        {
          title: `${product.name} ${normalizeVersion(version)}`,
          changelog: [],
          link: page ? { url: page, text: product.crate ? "crates.io" : "npm" } : undefined,
        },
        source,
      );
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
    return queueUpdate(
      key,
      product,
      {
        title: `${product.name} updated`,
        changelog,
        link: product.url ? { url: product.url, text: product.url.replace(/^https?:\/\//, "") } : undefined,
      },
      source,
    );
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
