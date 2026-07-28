import { Bot } from "grammy";
import { config } from "../config.js";
import { escapeHtml } from "../utils/html.js";

export const bot = new Bot(config.telegramBotToken);

bot.on("message:new_chat_members", async (ctx) => {
  for (const member of ctx.message.new_chat_members) {
    if (member.id === ctx.me.id) continue; // the bot itself being added to the group
    const name = escapeHtml(member.username ? `@${member.username}` : member.first_name);
    await ctx.reply(
      `👋 Welcome to Txio, ${name}! Feel free to introduce yourself. ` +
        `Issue, PR, CI, and deploy updates for the project get posted here automatically.`,
      { parse_mode: "HTML" },
    );
  }
});

export async function sendMessage(
  chatId: string | number,
  html: string,
  threadId?: number,
): Promise<void> {
  await bot.api.sendMessage(chatId, html, {
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    message_thread_id: threadId,
  });
}

export async function notifyChannel(html: string, threadId?: number): Promise<void> {
  return sendMessage(config.telegramChatId, html, threadId);
}
