import type { Bot, Context } from "grammy";
import { config } from "../config.js";
import { escapeHtml } from "../utils/html.js";
import {
  GitHubApiError,
  getRepoStats,
  listOpenIssuesByLabel,
  type LabeledIssue,
  type RepoStats,
} from "../github/api.js";

export interface CommandInfo {
  name: string;
  description: string;
  category: "repo" | "community" | "bot";
}

/**
 * Single source of truth for the /help menu (#40): every command added to
 * the bot must appear here, and the test suite asserts the help output
 * stays in sync with this registry.
 */
export const commandRegistry: CommandInfo[] = [
  { name: "help", description: "show this command menu", category: "bot" },
  { name: "ping", description: "check the bot is alive", category: "bot" },
  { name: "uptime", description: "how long the bot has been running", category: "bot" },
  { name: "stats", description: "open issues / open PRs / contributors for a repo", category: "repo" },
  { name: "goodfirstissue", description: "open issues labeled good-first-issue", category: "community" },
  { name: "help-wanted", description: "open issues labeled help-wanted", category: "community" },
];

const CATEGORY_TITLES: Record<CommandInfo["category"], string> = {
  repo: "📦 Repo info",
  community: "🤝 Contributing",
  bot: "🤖 Bot",
};

const TELEGRAM_MESSAGE_LIMIT = 4096;

const bootTime = Date.now();

export function buildHelpText(): string {
  const byCategory = new Map<CommandInfo["category"], CommandInfo[]>();
  for (const cmd of commandRegistry) {
    const list = byCategory.get(cmd.category) ?? [];
    list.push(cmd);
    byCategory.set(cmd.category, list);
  }
  const sections = [...byCategory.entries()].map(([category, cmds]) => {
    const lines = cmds.map((c) => `/${c.name} — ${c.description}`);
    return `${CATEGORY_TITLES[category]}\n${lines.join("\n")}`;
  });
  const header = "<b>Txio bot commands</b>";
  return [header, ...sections].join("\n\n");
}

/**
 * Resolves the repo a command should act on: explicit argument wins,
 * otherwise the first tracked repo from the routing config. Anything not
 * in the routing config is refused rather than guessed at.
 */
export function resolveRepo(arg: string | undefined): string | null {
  const candidate = arg?.trim().replace(/^@/, "").toLowerCase();
  if (candidate) {
    return candidate.includes("/") ? candidate : `txio-labs/${candidate}`;
  }
  return config.repos[0] ?? null;
}

const ISSUE_LIST_CAP = 8;

export function formatIssueList(label: string, repo: string, issues: LabeledIssue[]): string {
  if (issues.length === 0) {
    return `No open issues currently labeled <b>${escapeHtml(label)}</b> in ${escapeHtml(repo)}.`;
  }
  const lines = issues.map((i) => `• <a href="${i.html_url}">#${i.number}</a> ${escapeHtml(i.title)}`);
  const more = `… <a href="https://github.com/${repo}/issues?q=is%3Aopen+label%3A${encodeURIComponent(label)}">see all on GitHub</a>`;
  return [`<b>Open issues labeled ${escapeHtml(label)}</b> in ${escapeHtml(repo)}:`, ...lines, more].join("\n");
}

export function formatStats(repo: string, stats: RepoStats): string {
  return [
    `<b>${escapeHtml(repo)}</b>`,
    `Issues open: <b>${stats.openIssues}</b>`,
    `PRs open: <b>${stats.openPullRequests}</b>`,
    `Contributors: <b>${stats.contributors}</b>`,
  ].join("\n");
}

function formatUptime(): string {
  const seconds = Math.floor((Date.now() - bootTime) / 1000);
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (days || hours) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  return parts.join(" ");
}

async function reply(ctx: Context, text: string): Promise<void> {
  await ctx.reply(text, { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
}

/** Wraps command bodies so GitHub/argument failures answer the user instead of vanishing. */
async function safeReply(ctx: Context, body: (ctx: Context) => Promise<string>): Promise<void> {
  try {
    await reply(ctx, await body(ctx));
  } catch (err) {
    if (err instanceof GitHubApiError) {
      const hint = err.status === 404 ? "Unknown or unmapped repo." : "GitHub request failed — try again shortly.";
      await reply(ctx, `⚠️ ${hint}`);
      return;
    }
    throw err;
  }
}

function commandArg(ctx: Context): string | undefined {
  const text = ctx.message?.text ?? "";
  const match = text.match(/^\S+\s+(.+)$/);
  return match?.[1].trim();
}

export function registerCommands(bot: Bot): void {
  bot.command("help", async (ctx) => {
    await reply(ctx, buildHelpText());
  });

  bot.command("ping", async (ctx) => {
    await reply(ctx, "pong");
  });

  bot.command("uptime", async (ctx) => {
    await reply(ctx, `Uptime: ${formatUptime()}`);
  });

  bot.command("stats", async (ctx) => {
    await safeReply(ctx, async () => {
      const repo = resolveRepo(commandArg(ctx));
      if (!repo) return "No tracked repos configured.";
      return formatStats(repo, await getRepoStats(repo));
    });
  });

  const labelCommand = (label: string) => async (ctx: Context) => {
    await safeReply(ctx, async () => {
      const repo = resolveRepo(commandArg(ctx));
      if (!repo) return "No tracked repos configured.";
      const issues = await listOpenIssuesByLabel(repo, label, ISSUE_LIST_CAP);
      return formatIssueList(label, repo, issues);
    });
  };

  bot.command("goodfirstissue", labelCommand("good-first-issue"));
  bot.command("help-wanted", labelCommand("help-wanted"));
}
