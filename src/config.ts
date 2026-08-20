import "dotenv/config";
import { readFileSync } from "node:fs";

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

function optionalString(name: string): string | undefined {
  return process.env[name];
}

// ── Repo routing ──────────────────────────────────────────────────────

export type EventCategory = "issues" | "pullRequests" | "ci" | "deploys" | "branches";

export type RepoRoute = {
  chatId?: string | number;
  issues?: number;
  pullRequests?: number;
  ci?: number;
  deploys?: number;
  branches?: number;
};

export type RepoRoutingConfig = Record<string, RepoRoute>;

export type Destination = {
  chatId: string | number;
  threadId: number | undefined;
};

function loadRepoRoutingConfig(): RepoRoutingConfig {
  const configPath = process.env.REPO_ROUTING_CONFIG_PATH;
  if (!configPath) return {};

  let raw: string;
  try {
    raw = readFileSync(configPath, "utf-8");
  } catch (err) {
    throw new Error(
      `Failed to read REPO_ROUTING_CONFIG_PATH "${configPath}": ${(err as Error).message}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `REPO_ROUTING_CONFIG_PATH "${configPath}" contains invalid JSON: ${(err as Error).message}`,
    );
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(
      `REPO_ROUTING_CONFIG_PATH "${configPath}" must be a JSON object mapping repo full names to route configs`,
    );
  }

  for (const [repo, route] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof route !== "object" || route === null || Array.isArray(route)) {
      throw new Error(
        `REPO_ROUTING_CONFIG_PATH "${configPath}": entry for "${repo}" must be an object`,
      );
    }
    for (const key of Object.keys(route as Record<string, unknown>)) {
      const allowed = ["chatId", "issues", "pullRequests", "ci", "deploys", "branches"];
      if (!allowed.includes(key)) {
        throw new Error(
          `REPO_ROUTING_CONFIG_PATH "${configPath}": unknown key "${key}" in entry for "${repo}"`,
        );
      }
    }
  }

  return parsed as RepoRoutingConfig;
}

const repoRouting = loadRepoRoutingConfig();

export function resolveDestination(
  repoFullName: string | undefined,
  eventCategory: EventCategory,
  fallbackChatId: string | number,
  fallbackThreadId: number | undefined,
  routing: RepoRoutingConfig = repoRouting,
): Destination {
  if (!repoFullName) {
    return { chatId: fallbackChatId, threadId: fallbackThreadId };
  }

  const key = repoFullName.toLowerCase();
  const route = routing[key];

  if (!route) {
    return { chatId: fallbackChatId, threadId: fallbackThreadId };
  }

  const chatId = route.chatId ?? fallbackChatId;
  const threadId = eventCategory in route ? (route as Record<string, number | undefined>)[eventCategory] : fallbackThreadId;

  return { chatId, threadId };
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
    pullRequests: optionalInt("TOPIC_THREAD_PULL_REQUESTS"),
    ci: optionalInt("TOPIC_THREAD_CI"),
    deploys: optionalInt("TOPIC_THREAD_DEPLOYS"),
    branches: optionalInt("TOPIC_THREAD_BRANCHES"),
  },
  prOpened: {
    channel: process.env.PR_OPENED_CHANNEL ?? "main_chat",
    format: process.env.PR_OPENED_FORMAT ?? "markdown_summary",
  },
  prClosed: {
    channel: process.env.PR_CLOSED_CHANNEL ?? "main_chat",
    format: process.env.PR_CLOSED_FORMAT ?? "markdown_summary",
  },
  // If set, pull request notifications go to this chat (e.g. your personal DM)
  // instead of the group.
  pullRequestChatId: process.env.PULL_REQUEST_CHAT_ID || undefined,
  // Optional: GitHub token for merge-conflict detection on private repos.
  // A fine-grained PAT or GitHub App installation token with pull_requests: read scope.
  githubToken: optionalString("GITHUB_TOKEN"),
};

// Log a warning if githubToken is not set, since merge-conflict detection will be degraded.
if (!config.githubToken) {
  console.warn(
    "WARNING: GITHUB_TOKEN is not set. Merge-conflict detection will not work for private repos and may fail due to rate limits on public repos."
  );
}
