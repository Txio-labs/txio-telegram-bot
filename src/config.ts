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

function optionalPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function optionalString(name: string): string | undefined {
  return process.env[name];
}

// ── Repo routing ──────────────────────────────────────────────────────

export type EventCategory =
  | "issues"
  | "pullRequests"
  | "ci"
  | "deploys"
  | "branches"
  | "security";

export type EventCategoryConfig = {
  threadId?: number;
  /** Optional label allowlist. When set, only events with at least one matching label are forwarded. Matching is case-sensitive. */
  labels?: string[];
};

export type RepoRoute = {
  chatId?: string | number;
  issues?: number | EventCategoryConfig;
  pullRequests?: number | EventCategoryConfig;
  ci?: number | EventCategoryConfig;
  deploys?: number | EventCategoryConfig;
  branches?: number | EventCategoryConfig;
  security?: number | EventCategoryConfig;
};

export type RepoRoutingConfig = Record<string, RepoRoute>;

export type Destination = {
  chatId: string | number;
  threadId: number | undefined;
  /** Label allowlist for this destination, if configured. */
  labels?: string[];
};

function validateEventCategoryValue(
  configPath: string,
  repo: string,
  field: string,
  value: unknown,
): void {
  if (value === undefined) return;
  if (typeof value === "number") return; // legacy numeric threadId form

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(
      `REPO_ROUTING_CONFIG_PATH "${configPath}": "${field}" in entry for "${repo}" must be a number or an object`,
    );
  }

  const obj = value as Record<string, unknown>;
  if ("threadId" in obj && typeof obj.threadId !== "number") {
    throw new Error(
      `REPO_ROUTING_CONFIG_PATH "${configPath}": "${field}.threadId" in entry for "${repo}" must be a number`,
    );
  }
  if ("labels" in obj) {
    const labels = obj.labels;
    if (
      !Array.isArray(labels) ||
      labels.length === 0 ||
      !labels.every((l) => typeof l === "string")
    ) {
      throw new Error(
        `REPO_ROUTING_CONFIG_PATH "${configPath}": "${field}.labels" in entry for "${repo}" must be a non-empty array of strings`,
      );
    }
  }
}

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

  const eventCategoryFields = ["issues", "pullRequests", "ci", "deploys", "branches", "security"] as const;

  for (const [repo, route] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof route !== "object" || route === null || Array.isArray(route)) {
      throw new Error(
        `REPO_ROUTING_CONFIG_PATH "${configPath}": entry for "${repo}" must be an object`,
      );
    }
    for (const key of Object.keys(route as Record<string, unknown>)) {
      const allowed = ["chatId", "issues", "pullRequests", "ci", "deploys", "branches", "security"];
      if (!allowed.includes(key)) {
        throw new Error(
          `REPO_ROUTING_CONFIG_PATH "${configPath}": unknown key "${key}" in entry for "${repo}"`,
        );
      }
    }
    const routeObj = route as Record<string, unknown>;
    for (const field of eventCategoryFields) {
      validateEventCategoryValue(configPath, repo, field, routeObj[field]);
    }
  }

  return parsed as RepoRoutingConfig;
}

const repoRouting = loadRepoRoutingConfig();

// Repos the stale-reminder job monitors. Prefer the repos already mapped in
// REPO_ROUTING_CONFIG_PATH; STALE_REPO_NAMES is the fallback when no routing
// file is configured (e.g. a single-repo deployment).
const trackedRepos = (() => {
  const fromRouting = Object.keys(repoRouting).map((repo) => repo.toLowerCase());
  if (fromRouting.length > 0) return fromRouting;
  return (process.env.STALE_REPO_NAMES ?? "")
    .split(",")
    .map((repo) => repo.trim().toLowerCase())
    .filter(Boolean);
})();

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
  const rawValue = eventCategory in route ? (route as Record<string, unknown>)[eventCategory] : undefined;

  let threadId: number | undefined;
  let labels: string[] | undefined;

  if (rawValue === undefined) {
    threadId = fallbackThreadId;
  } else if (typeof rawValue === "number") {
    threadId = rawValue;
  } else if (typeof rawValue === "object" && rawValue !== null) {
    const catConfig = rawValue as EventCategoryConfig;
    threadId = catConfig.threadId ?? fallbackThreadId;
    labels = catConfig.labels;
  } else {
    threadId = fallbackThreadId;
  }

  return { chatId, threadId, ...(labels !== undefined ? { labels } : {}) };
}

/**
 * Returns true if the event's payload labels contain at least one entry
 * that matches the destination's allowlist (case-sensitive exact match).
 *
 * If the destination has no `labels` allowlist configured, always returns
 * true (all events pass through). If the allowlist is set but the payload
 * has zero labels, returns false.
 */
export function labelMatchesAllowlist(
  payloadLabels: string[],
  allowlist: string[] | undefined,
): boolean {
  if (!allowlist) return true;
  return payloadLabels.some((label) => allowlist.includes(label));
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
    security: optionalInt("TOPIC_THREAD_SECURITY"),
  },
  prOpened: {
    channel: process.env.PR_OPENED_CHANNEL ?? "main_chat",
    format: process.env.PR_OPENED_FORMAT ?? "markdown_summary",
  },
  prClosed: {
    channel: process.env.PR_CLOSED_CHANNEL ?? "main_chat",
    format: process.env.PR_CLOSED_FORMAT ?? "markdown_summary",
  },
  securityAlert: {
    channel: process.env.SECURITY_ALERT_CHANNEL ?? "main_chat",
    format: process.env.SECURITY_ALERT_FORMAT ?? "markdown_summary",
  },
  // If set, security alert notifications go to this chat (e.g. your personal DM)
  // instead of the group.
  securityAlertChatId: process.env.SECURITY_ALERT_CHAT_ID || undefined,
  // If set, pull request notifications go to this chat (e.g. your personal DM)
  // instead of the group.
  pullRequestChatId: process.env.PULL_REQUEST_CHAT_ID || undefined,
  // Optional: GitHub token for merge-conflict detection on private repos.
  // A fine-grained PAT or GitHub App installation token with pull_requests: read scope.
  githubToken: optionalString("GITHUB_TOKEN"),
  // Scheduled digest of stale (no recent activity) open PRs/issues.
  staleReminder: {
    // Cron expression for the daily reminder. Default: 09:00 UTC.
    cron: process.env.STALE_REMINDER_CRON ?? "0 9 * * *",
    // An open PR/issue counts as stale when its updated_at is older than this.
    thresholdDays: optionalPositiveInt("STALE_THRESHOLD_DAYS", 7),
    // Repos to query; derived from REPO_ROUTING_CONFIG_PATH (or STALE_REPO_NAMES).
    repos: trackedRepos,
  },
};

// Log a warning if githubToken is not set, since merge-conflict detection will be degraded.
if (!config.githubToken) {
  console.warn(
    "WARNING: GITHUB_TOKEN is not set. Merge-conflict detection will not work for private repos and may fail due to rate limits on public repos."
  );
}
