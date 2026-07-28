import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  telegramBotToken: required("TELEGRAM_BOT_TOKEN"),
  telegramChatId: required("TELEGRAM_CHAT_ID"),
  githubWebhookSecret: required("GITHUB_WEBHOOK_SECRET"),
  githubWebhookPath: process.env.GITHUB_WEBHOOK_PATH ?? "/webhooks/github",
};
