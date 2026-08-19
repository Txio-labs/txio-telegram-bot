import { Bot } from "grammy";
import { config } from "../config.js";
import { escapeHtml } from "../utils/html.js";

export const bot = new Bot(config.telegramBotToken);

// Catch-all error handler to prevent unhandled promise rejections from crashing the process
bot.catch((err) => {
  console.error("Telegram bot error caught by bot.catch():", err);
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
