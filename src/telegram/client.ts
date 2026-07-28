import { Bot } from "grammy";
import { config } from "../config.js";

const bot = new Bot(config.telegramBotToken);

export async function notifyChannel(html: string): Promise<void> {
  await bot.api.sendMessage(config.telegramChatId, html, {
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
  });
}
