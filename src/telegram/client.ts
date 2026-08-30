import { Bot } from "grammy";
import { autoRetry } from "@grammyjs/auto-retry";
import { config, resolveRepoName, getConfiguredRepos } from "../config.js";
import { escapeHtml } from "../utils/html.js";
import { buildCuratedIssuesReply } from "./issueCommands.js";
import {
  getRepoSummary,
  getPullRequestDetail,
  getCommitStatuses,
  getCheckRunsForRef,
  GitHubApiError,
} from "../github/api.js";
import {
  formatRepoSummary,
  formatPullRequestDetail,
  formatRepoNotFound,
  formatPrNotFound,
  formatApiError,
} from "../github/command-formatters.js";

export const bot = new Bot(config.telegramBotToken);

bot.api.config.use(
  autoRetry({
    maxRetryAttempts: 5,
    maxDelaySeconds: 30,
  }),
);

// Catch-all error handler to prevent unhandled promise rejections from crashing the process
bot.catch((err) => {
  console.error("Telegram bot error caught by bot.catch():", err);
});

// ── /repo command ──────────────────────────────────────────────────
bot.command("repo", async (ctx) => {
  const input = (ctx.match ?? "").trim();
  if (!input) {
    const repos = getConfiguredRepos();
    if (repos.length === 0) {
      await ctx.reply("No repositories configured. Set REPO_ROUTING_CONFIG_PATH first.");
      return;
    }
    const list = repos.map((r) => `• ${escapeHtml(r)}`).join("\n");
    await ctx.reply(
      `Available repos:\n${list}\n\nUsage: /repo <name>`,
      { parse_mode: "HTML" },
    );
    return;
  }

  const fullName = resolveRepoName(input);
  if (!fullName) {
    await ctx.reply(formatRepoNotFound(input), { parse_mode: "HTML" });
    return;
  }

  try {
    const summary = await getRepoSummary(fullName);
    await ctx.reply(formatRepoSummary(summary), { parse_mode: "HTML" });
  } catch (err) {
    if (err instanceof GitHubApiError) {
      await ctx.reply(formatApiError(err.message), { parse_mode: "HTML" });
    } else {
      console.error("/repo command error:", err);
      await ctx.reply(formatApiError("An unexpected error occurred."), { parse_mode: "HTML" });
    }
  }
});

// ── /pr command ────────────────────────────────────────────────────
bot.command("pr", async (ctx) => {
  const input = (ctx.match ?? "").trim();
  if (!input) {
    await ctx.reply(
      "Usage: /pr <repo>#<number>\nExample: /pr backend#42",
      { parse_mode: "HTML" },
    );
    return;
  }

  // Parse "repo#number" or "repo #number" or "repo name#number"
  const match = input.match(/^(.+?)\s*#(\d+)$/);
  if (!match) {
    await ctx.reply(
      "Invalid format. Use: /pr <repo>#<number>\nExample: /pr backend#42",
      { parse_mode: "HTML" },
    );
    return;
  }

  const [, repoPart, numberStr] = match;
  const prNumber = parseInt(numberStr!, 10);

  const fullName = resolveRepoName(repoPart!.trim());
  if (!fullName) {
    await ctx.reply(formatRepoNotFound(repoPart!.trim()), { parse_mode: "HTML" });
    return;
  }

  try {
    const [pr, commitStatus, checkRuns] = await Promise.all([
      getPullRequestDetail(fullName, prNumber),
      getCommitStatuses(fullName, prNumber.toString()),
      getCheckRunsForRef(fullName, prNumber.toString()),
    ]);
    await ctx.reply(
      formatPullRequestDetail(pr, commitStatus, checkRuns),
      { parse_mode: "HTML" },
    );
  } catch (err) {
    if (err instanceof GitHubApiError) {
      if (err.status === 404) {
        await ctx.reply(formatPrNotFound(fullName, prNumber), { parse_mode: "HTML" });
      } else {
        await ctx.reply(formatApiError(err.message), { parse_mode: "HTML" });
      }
    } else {
      console.error("/pr command error:", err);
      await ctx.reply(formatApiError("An unexpected error occurred."), { parse_mode: "HTML" });
    }
  }
});

bot.command("goodfirstissue", async (ctx) => {
  const reply = await buildCuratedIssuesReply("goodfirstissue", ctx.match);
  await ctx.reply(reply, { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
});

bot.hears(/^\/help-wanted(?:@\w+)?(?:\s+(.+))?$/i, async (ctx) => {
  const reply = await buildCuratedIssuesReply("help-wanted", ctx.match?.[1]);
  await ctx.reply(reply, { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
});

bot.on("message:new_chat_members", async (ctx) => {
  if (!Array.isArray(ctx.message?.new_chat_members)) return;
  for (const member of ctx.message.new_chat_members) {
    if (!member || typeof member !== "object" || typeof member.id !== "number") {
      continue;
    }
    if (member.id === ctx.me?.id) continue; // the bot itself being added to the group
    const name = escapeHtml(member.username ? `@${member.username}` : member.first_name || "member");
    await ctx.reply(
      `👋 Welcome to Txio, ${name}! Feel free to introduce yourself. ` +
        `Issue, PR, CI, and deploy updates for the project get posted here automatically.`,
      { parse_mode: "HTML" },
    );
  }
});

export async function sendMessage(
  chatId: string | number,
  text: string,
  threadId?: number,
  options?: { parseMode?: "HTML"; replyMarkup?: any }
): Promise<void> {
  const parse_mode = options && "parseMode" in options ? options.parseMode : "HTML";
  await bot.api.sendMessage(chatId, text, {
    ...(parse_mode ? { parse_mode } : {}),
    link_preview_options: { is_disabled: true },
    message_thread_id: threadId,
    reply_markup: options?.replyMarkup,
  });
}

export async function notifyChannel(
  text: string,
  threadId?: number,
  options?: { parseMode?: "HTML"; replyMarkup?: any }
): Promise<void> {
  return sendMessage(config.telegramChatId, text, threadId, options);
}
