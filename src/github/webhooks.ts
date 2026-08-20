import { Webhooks } from "@octokit/webhooks";
import { config, resolveDestination, labelMatchesAllowlist } from "../config.js";
import { sendMessage } from "../telegram/client.js";
import {
  formatDeploymentStatusEvent,
  formatIssueEvent,
  formatMergeConflictEvent,
  formatPullRequestClosedEvent,
  formatPullRequestOpenedEvent,
  formatWorkflowRunEvent,
} from "./formatters.js";

export const webhooks = new Webhooks({ secret: config.githubWebhookSecret });

// Bounded in-memory dedup cache for X-GitHub-Delivery IDs
const MAX_DELIVERY_CACHE_SIZE = 1000;
export const seenDeliveries = new Set<string>();

export function isDuplicateDelivery(id: string | undefined): boolean {
  if (!id) return false;
  if (seenDeliveries.has(id)) {
    return true;
  }
  if (seenDeliveries.size >= MAX_DELIVERY_CACHE_SIZE) {
    const firstKey = seenDeliveries.values().next().value;
    if (firstKey) seenDeliveries.delete(firstKey);
  }
  seenDeliveries.add(id);
  return false;
}

webhooks.on(["issues.opened", "issues.closed", "issues.reopened"], async (event) => {
  if (isDuplicateDelivery(event.id)) return;
  const dest = resolveDestination(
    event.payload.repository?.full_name,
    "issues",
    config.telegramChatId,
    config.topicThreads.issues,
  );
  const payloadLabels = (event.payload.issue.labels ?? []).map((l) => l.name).filter((n): n is string => typeof n === "string");
  if (!labelMatchesAllowlist(payloadLabels, dest.labels)) {
    console.debug("[label-filter] suppressed issues event", {
      repo: event.payload.repository?.full_name,
      event: `issues.${event.payload.action}`,
      deliveryId: event.id ?? "unknown",
      payloadLabels,
      allowlist: dest.labels,
    });
    return;
  }
  await sendMessage(dest.chatId, formatIssueEvent(event), dest.threadId);
});

webhooks.on(["pull_request.closed", "pull_request.reopened"], async (event) => {
  if (isDuplicateDelivery(event.id)) return;
  const { channel, format } = config.prClosed;
  const { text, parseMode, replyMarkup } = formatPullRequestClosedEvent(event, format);

  const repoFullName = event.payload.repository?.full_name;
  let targetChatId: string | number = config.telegramChatId;
  let threadId: number | undefined;
  let allowlist: string[] | undefined;

  if (channel === "topic_thread") {
    const dest = resolveDestination(repoFullName, "pullRequests", config.telegramChatId, config.topicThreads.pullRequests);
    targetChatId = dest.chatId;
    threadId = dest.threadId;
    allowlist = dest.labels;
  } else if (channel === "dm") {
    if (config.pullRequestChatId) {
      targetChatId = config.pullRequestChatId;
    }
    const dest = resolveDestination(repoFullName, "pullRequests", config.telegramChatId, config.topicThreads.pullRequests);
    allowlist = dest.labels;
  } else {
    const dest = resolveDestination(repoFullName, "pullRequests", config.telegramChatId, config.topicThreads.pullRequests);
    allowlist = dest.labels;
  }

  const payloadLabels = (event.payload.pull_request.labels ?? []).map((l) => l.name).filter((n): n is string => typeof n === "string");
  if (!labelMatchesAllowlist(payloadLabels, allowlist)) {
    console.debug("[label-filter] suppressed pull_request event", {
      repo: repoFullName,
      event: `pull_request.${event.payload.action}`,
      deliveryId: event.id ?? "unknown",
      payloadLabels,
      allowlist,
    });
    return;
  }

  await sendMessage(targetChatId, text, threadId, { parseMode, replyMarkup });
});

webhooks.on("pull_request.opened", async (event) => {
  if (isDuplicateDelivery(event.id)) return;
  const { channel, format } = config.prOpened;
  const { text, parseMode, replyMarkup } = formatPullRequestOpenedEvent(event, format);

  const repoFullName = event.payload.repository?.full_name;
  let targetChatId: string | number = config.telegramChatId;
  let threadId: number | undefined;
  let allowlist: string[] | undefined;

  if (channel === "topic_thread") {
    const dest = resolveDestination(repoFullName, "pullRequests", config.telegramChatId, config.topicThreads.pullRequests);
    targetChatId = dest.chatId;
    threadId = dest.threadId;
    allowlist = dest.labels;
  } else if (channel === "dm") {
    if (config.pullRequestChatId) {
      targetChatId = config.pullRequestChatId;
    }
    const dest = resolveDestination(repoFullName, "pullRequests", config.telegramChatId, config.topicThreads.pullRequests);
    allowlist = dest.labels;
  } else {
    const dest = resolveDestination(repoFullName, "pullRequests", config.telegramChatId, config.topicThreads.pullRequests);
    allowlist = dest.labels;
  }

  const payloadLabels = (event.payload.pull_request.labels ?? []).map((l) => l.name).filter((n): n is string => typeof n === "string");
  if (!labelMatchesAllowlist(payloadLabels, allowlist)) {
    console.debug("[label-filter] suppressed pull_request event", {
      repo: repoFullName,
      event: `pull_request.${event.payload.action}`,
      deliveryId: event.id ?? "unknown",
      payloadLabels,
      allowlist,
    });
    return;
  }

  await sendMessage(targetChatId, text, threadId, { parseMode, replyMarkup });
});

// GitHub computes `mergeable` asynchronously, so it's often null on the
// webhook payload itself. Give it a few seconds, then check via the REST
// API before deciding whether to alert.
export async function isMergeConflicted(
  pr: { number: number; mergeable?: boolean | null },
  repository: { full_name: string },
): Promise<boolean> {
  if (pr.mergeable !== null && pr.mergeable !== undefined) return pr.mergeable === false;

  await new Promise((resolve) => setTimeout(resolve, 4000));
  const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
  if (config.githubToken) {
    headers.Authorization = `Bearer ${config.githubToken}`;
  }
  const res = await fetch(`https://api.github.com/repos/${repository.full_name}/pulls/${pr.number}`, {
    headers,
  });
  if (!res.ok) return false;
  const data = (await res.json()) as { mergeable: boolean | null };
  return data.mergeable === false;
}

webhooks.on(["pull_request.opened", "pull_request.synchronize", "pull_request.reopened"], async (event) => {
  if (isDuplicateDelivery(event.id)) return;
  const { pull_request: pr, repository } = event.payload;

  const dest = resolveDestination(
    repository?.full_name,
    "pullRequests",
    config.pullRequestChatId ?? config.telegramChatId,
    undefined,
  );

  const payloadLabels = (pr.labels ?? []).map((l) => l.name).filter((n): n is string => typeof n === "string");
  if (!labelMatchesAllowlist(payloadLabels, dest.labels)) {
    console.debug("[label-filter] suppressed merge-conflict check", {
      repo: repository?.full_name,
      event: `pull_request.${event.payload.action}`,
      deliveryId: event.id ?? "unknown",
      payloadLabels,
      allowlist: dest.labels,
    });
    return;
  }

  if (!(await isMergeConflicted(pr, repository))) return;
  const message = formatMergeConflictEvent(pr, repository);
  await sendMessage(dest.chatId, message);
});

webhooks.on("workflow_run.completed", async (event) => {
  if (isDuplicateDelivery(event.id)) return;
  const message = formatWorkflowRunEvent(event);
  if (message) {
    const { chatId, threadId } = resolveDestination(
      event.payload.repository?.full_name,
      "ci",
      config.telegramChatId,
      config.topicThreads.ci,
    );
    await sendMessage(chatId, message, threadId);
  }
});

webhooks.on("deployment_status.created", async (event) => {
  if (isDuplicateDelivery(event.id)) return;
  const { chatId, threadId } = resolveDestination(
    event.payload.repository?.full_name,
    "deploys",
    config.telegramChatId,
    config.topicThreads.deploys,
  );
  await sendMessage(chatId, formatDeploymentStatusEvent(event), threadId);
});

webhooks.onError((error) => {
  console.error("Webhook handling failed:", error.message);
});
