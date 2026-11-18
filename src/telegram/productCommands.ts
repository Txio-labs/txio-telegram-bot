import type { Bot, Context } from "grammy";
import { fetchLatestRelease, type GitHubRelease } from "../releases/github.js";
import { link } from "../github/formatters.js";
import type { Product } from "../products.js";
import { findProductById } from "../products.js";
import { downloadButtons, normalizeVersion, products, registryPageUrl } from "../releases/announce.js";
import { fetchCrateVersion, fetchNpmVersion } from "../releases/poller.js";
import { getStatusText } from "../status.js";
import { getState, updateState } from "../store.js";
import { escapeHtml } from "../utils/html.js";
import { buildHelpText, commandRegistry } from "./commands.js";


const HTML = { parse_mode: "HTML" as const, link_preview_options: { is_disabled: true } };

// ── Latest-release cache (commands must not burn the GitHub rate limit) ──

const CACHE_MS = 5 * 60 * 1000;
const releaseCache = new Map<string, { at: number; release: GitHubRelease | null }>();

async function latestRelease(product: Product): Promise<GitHubRelease | null> {
  const hit = releaseCache.get(product.id);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.release;
  const release = await fetchLatestRelease(product.repo);
  releaseCache.set(product.id, { at: Date.now(), release });
  return release;
}

export function clearCommandCacheForTests(): void {
  releaseCache.clear();
}

async function latestVersionLine(product: Product): Promise<string> {
  const name = `<b>${escapeHtml(product.name)}</b>`;
  if (product.trigger === "deploy") {
    return `${name}: always current${product.url ? ` at ${link(product.url, product.url.replace(/^https?:\/\//, ""))}` : ""}`;
  }
  try {
    const release = await latestRelease(product);
    if (release) {
      const install = product.install ? `\n   <code>${escapeHtml(product.install)}</code>` : "";
      return `${name}: ${link(release.html_url, release.tag_name)}${install}`;
    }
    const version = product.crate
      ? await fetchCrateVersion(product.crate)
      : product.npm
        ? await fetchNpmVersion(product.npm)
        : null;
    const page = registryPageUrl(product);
    if (version && page) return `${name}: ${link(page, normalizeVersion(version))}`;
    return `${name}: not released yet`;
  } catch (error) {
    console.warn(`[commands] latest ${product.id} failed:`, error);
    return `${name}: could not check right now`;
  }
}

// ── Subscriptions ─────────────────────────────────────────────────────

function subscribable(): Product[] {
  return products();
}

export function subscriptionsOf(chatId: string): string[] {
  return getState().subscriptions[chatId] ?? [];
}

export async function setSubscription(chatId: string, productIds: string[], on: boolean): Promise<string[]> {
  await updateState((s) => {
    const current = new Set(s.subscriptions[chatId] ?? []);
    for (const id of productIds) (on ? current.add(id) : current.delete(id));
    if (current.size === 0) delete s.subscriptions[chatId];
    else s.subscriptions[chatId] = [...current].sort();
  });
  return subscriptionsOf(chatId);
}

/** Resolves "/subscribe desktop", "/subscribe all"; returns null for unknown names. */
export function parseProductArg(arg: string): string[] | null {
  const value = arg.trim().toLowerCase();
  if (value === "all") return subscribable().map((p) => p.id);
  const product = findProductById(subscribable(), value);
  return product ? [product.id] : null;
}

function describeSubscriptions(ids: string[]): string {
  if (ids.length === 0) return "You are not subscribed to anything.";
  const names = ids.map((id) => findProductById(subscribable(), id)?.name ?? id);
  return `You get release notes for: ${escapeHtml(names.join(", "))}.`;
}

function subscribeKeyboard(chatId: string, action: "sub" | "unsub") {
  const current = new Set(subscriptionsOf(chatId));
  const options = subscribable().filter((p) => (action === "sub" ? !current.has(p.id) : current.has(p.id)));
  const rows = options.map((p) => [{ text: `${action === "sub" ? "➕" : "➖"} ${p.name}`, callback_data: `${action}:${p.id}` }]);
  if (options.length > 1) rows.push([{ text: action === "sub" ? "All of them" : "Everything", callback_data: `${action}:all` }]);
  return { inline_keyboard: rows };
}

function isPrivate(ctx: Context): boolean {
  return ctx.chat?.type === "private";
}

async function askToDm(ctx: Context): Promise<void> {
  const username = ctx.me?.username;
  await ctx.reply(
    username
      ? `Subscriptions are per person. Open a DM with me: https://t.me/${username}?start=subscribe`
      : "Subscriptions are per person. Send me this command in a private chat.",
    { link_preview_options: { is_disabled: true } },
  );
}

async function handleSubscribe(ctx: Context, arg: string, on: boolean): Promise<void> {
  if (!isPrivate(ctx)) return askToDm(ctx);
  const chatId = String(ctx.chat!.id);
  if (!arg.trim()) {
    const keyboard = subscribeKeyboard(chatId, on ? "sub" : "unsub");
    if (keyboard.inline_keyboard.length === 0) {
      await ctx.reply(on ? "You already get every release. /unsubscribe to stop." : describeSubscriptions([]));
      return;
    }
    await ctx.reply(on ? "Which releases do you want by DM?" : "Stop which releases?", { reply_markup: keyboard });
    return;
  }
  const ids = parseProductArg(arg);
  if (!ids) {
    const known = subscribable().map((p) => p.id).join(", ");
    await ctx.reply(`Unknown product "${arg.trim()}". Use one of: ${known}, or all.`);
    return;
  }
  const now = await setSubscription(chatId, ids, on);
  await ctx.reply(describeSubscriptions(now), HTML);
}

// ── Handlers ──────────────────────────────────────────────────────────


/** Registers /start, /download, /latest, /status and the subscription commands. */
export function registerProductCommands(bot: Bot): void {
  bot.command("start", async (ctx) => {
    if (ctx.match === "subscribe") return handleSubscribe(ctx, "", true);
    await ctx.reply(buildHelpText(), HTML);
  });

  bot.command("download", async (ctx) => {
    const desktop = products().find((p) => p.trigger === "workflow");
    if (!desktop) return void (await ctx.reply("No desktop app is configured."));
    try {
      const release = await latestRelease(desktop);
      if (!release) return void (await ctx.reply(`${desktop.name} has no release yet.`));
      await ctx.reply(
        `⬇️ <b>${escapeHtml(`${desktop.name} ${release.tag_name}`)}</b>\nPick your system. Installed already? It updates itself.`,
        { ...HTML, reply_markup: downloadButtons(release, desktop.url) },
      );
    } catch (error) {
      console.warn("[commands] /download failed:", error);
      await ctx.reply("Could not reach GitHub right now. Try again in a minute.");
    }
  });

  bot.command("latest", async (ctx) => {
    const lines = await Promise.all(products().map(latestVersionLine));
    await ctx.reply(lines.join("\n"), HTML);
  });

  bot.command("status", async (ctx) => {
    await ctx.replyWithChatAction("typing").catch(() => undefined);
    await ctx.reply(await getStatusText(), HTML);
  });

  bot.command("subscribe", (ctx) => handleSubscribe(ctx, ctx.match, true));
  bot.command("unsubscribe", (ctx) => handleSubscribe(ctx, ctx.match, false));

  bot.command(["subscriptions", "mysubs"], async (ctx) => {
    if (!isPrivate(ctx)) return askToDm(ctx);
    await ctx.reply(describeSubscriptions(subscriptionsOf(String(ctx.chat.id))), HTML);
  });

  bot.callbackQuery(/^(sub|unsub):([a-z0-9-]+)$/, async (ctx) => {
    if (!isPrivate(ctx)) return void (await ctx.answerCallbackQuery());
    const [, action, target] = ctx.match;
    const ids = parseProductArg(target);
    if (!ids) return void (await ctx.answerCallbackQuery({ text: "That product no longer exists." }));
    const chatId = String(ctx.chat!.id);
    const now = await setSubscription(chatId, ids, action === "sub");
    await ctx.answerCallbackQuery({ text: action === "sub" ? "Subscribed" : "Unsubscribed" });
    await ctx.editMessageText(describeSubscriptions(now), HTML).catch(() => undefined);
  });
}

/** Registers the command menu shown in Telegram's "/" picker, from the /help registry. */
export async function publishCommandMenu(bot: Bot): Promise<void> {
  // Telegram menu commands allow only lowercase letters, digits and "_".
  const commands = commandRegistry
    .filter((c) => /^[a-z0-9_]{1,32}$/.test(c.name))
    .map((c) => ({ command: c.name, description: c.description }));
  try {
    await bot.api.setMyCommands(commands);
  } catch (error) {
    console.warn("Failed to set the bot command menu:", error);
  }
}
