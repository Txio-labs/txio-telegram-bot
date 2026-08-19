import { Webhooks } from "@octokit/webhooks";
import { config, resolveDestination } from "../config.js";
import { sendMessage } from "../telegram/client.js";
import {
  formatBranchCreatedEvent,
  formatBranchDeletedEvent,
  formatDeploymentStatusEvent,
  formatForcePushEvent,
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
  const { chatId, threadId } = resolveDestination(
    event.payload.repository?.full_name,
    "issues",
    config.telegramChatId,
    config.topicThreads.issues,
  );
  await sendMessage(chatId, formatIssueEvent(event), threadId);
});

webhooks.on(["pull_request.closed", "pull_request.reopened"], async (event) => {
  if (isDuplicateDelivery(event.id)) return;
  const { channel, format } = config.prClosed;
  const { text, parseMode, replyMarkup } = formatPullRequestClosedEvent(event, format);

  const repoFullName = event.payload.repository?.full_name;
  let targetChatId: string | number = config.telegramChatId;
  let threadId: number | undefined;

  if (channel === "topic_thread") {
    const dest = resolveDestination(repoFullName, "pullRequests", config.telegramChatId, config.topicThreads.pullRequests);
    targetChatId = dest.chatId;
    threadId = dest.threadId;
  } else if (channel === "dm") {
    if (config.pullRequestChatId) {
      targetChatId = config.pullRequestChatId;
    }
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

  if (channel === "topic_thread") {
    const dest = resolveDestination(repoFullName, "pullRequests", config.telegramChatId, config.topicThreads.pullRequests);
    targetChatId = dest.chatId;
    threadId = dest.threadId;
  } else if (channel === "dm") {
    if (config.pullRequestChatId) {
      targetChatId = config.pullRequestChatId;
    }
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
  if (!(await isMergeConflicted(pr, repository))) return;
  const message = formatMergeConflictEvent(pr, repository);
  const { chatId } = resolveDestination(
    repository?.full_name,
    "pullRequests",
    config.pullRequestChatId ?? config.telegramChatId,
    undefined,
  );
  await sendMessage(chatId, message);
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

export function isBranchRef(refType: string | undefined): boolean {
  return refType === "branch";
}

export function isForcePushToDefaultBranch(
  ref: string | undefined,
  forced: boolean | undefined,
  defaultBranch: string | undefined,
): boolean {
  return forced === true && !!ref && !!defaultBranch && ref === `refs/heads/${defaultBranch}`;
}

webhooks.on("create", async (event) => {
  if (isDuplicateDelivery(event.id)) return;
  if (!isBranchRef(event.payload.ref_type)) return;
  const { chatId, threadId } = resolveDestination(
    event.payload.repository?.full_name,
    "branches",
    config.telegramChatId,
    config.topicThreads.branches,
  );
  await sendMessage(chatId, formatBranchCreatedEvent(event), threadId);
});

webhooks.on("delete", async (event) => {
  if (isDuplicateDelivery(event.id)) return;
  if (!isBranchRef(event.payload.ref_type)) return;
  const { chatId, threadId } = resolveDestination(
    event.payload.repository?.full_name,
    "branches",
    config.telegramChatId,
    config.topicThreads.branches,
  );
  await sendMessage(chatId, formatBranchDeletedEvent(event), threadId);
});

webhooks.on("push", async (event) => {
  if (isDuplicateDelivery(event.id)) return;
  const { ref, forced, repository } = event.payload;
  if (!isForcePushToDefaultBranch(ref, forced, repository?.default_branch)) return;
  const { chatId, threadId } = resolveDestination(
    repository?.full_name,
    "branches",
    config.telegramChatId,
    config.topicThreads.branches,
  );
  await sendMessage(chatId, formatForcePushEvent(event), threadId);
});

webhooks.onError((error) => {
  console.error("Webhook handling failed:", error.message);
});
