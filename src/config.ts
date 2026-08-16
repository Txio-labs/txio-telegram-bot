import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalInt(name: string): number | undefined {
  const value = process.env[name];
  return value ? Number(value) : undefined;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  telegramBotToken: required("TELEGRAM_BOT_TOKEN"),
  telegramChatId: required("TELEGRAM_CHAT_ID"),
  telegramWebhookSecret: required("TELEGRAM_WEBHOOK_SECRET"),
  githubWebhookSecret: required("GITHUB_WEBHOOK_SECRET"),
  githubWebhookPath: process.env.GITHUB_WEBHOOK_PATH ?? "/webhooks/github",
  // Public base URL this service is reachable at, used to register the Telegram webhook.
  publicUrl: required("PUBLIC_URL"),
  telegramWebhookPath: process.env.TELEGRAM_WEBHOOK_PATH ?? "/telegram/webhook",
  // Forum topic (message_thread_id) each event type posts into. Unset = group's General topic.
  topicThreads: {
    issues: optionalInt("TOPIC_THREAD_ISSUES"),
    ci: optionalInt("TOPIC_THREAD_CI"),
    deploys: optionalInt("TOPIC_THREAD_DEPLOYS"),
  },
  // If set, pull request notifications go to this chat (e.g. your personal DM)
  // instead of the group.
  pullRequestChatId: process.env.PULL_REQUEST_CHAT_ID || undefined,
};
