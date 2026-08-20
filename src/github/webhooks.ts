import { Webhooks } from "@octokit/webhooks";
import { config, resolveDestination, getDeliveryConfig, EventCategory } from "../config.js";
import { sendMessage } from "../telegram/client.js";
import {
  formatDeploymentStatusEvent,
  formatIssueEvent,
  formatMergeConflictEvent,
  formatPullRequestClosedEvent,
  formatPullRequestOpenedEvent,
  formatWorkflowRunEvent,
} from "./formatters.js";

async function dispatchNotification(
  eventName: string,
  repoFullName: string | undefined,
  eventCategory: EventCategory,
  formatterResult: { text: string; parseMode?: "HTML"; replyMarkup?: any } | null
) {
  if (!formatterResult) return;
  const { channel } = getDeliveryConfig(eventName);
  const { text, parseMode, replyMarkup } = formatterResult;

  let targetChatId: string | number = config.telegramChatId;
  let threadId: number | undefined;

  if (channel === "topic_thread") {
    const dest = resolveDestination(repoFullName, eventCategory, config.telegramChatId, config.topicThreads[eventCategory]);
    targetChatId = dest.chatId;
    threadId = dest.threadId;
  } else if (channel === "dm") {
    if (config.pullRequestChatId) {
      targetChatId = config.pullRequestChatId;
    }
  }

  await sendMessage(targetChatId, text, threadId, { parseMode, replyMarkup });
}

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
  const eventName = `issues.${event.payload.action}`;
  const { format } = getDeliveryConfig(eventName);
  await dispatchNotification(
    eventName,
    event.payload.repository?.full_name,
    "issues",
    formatIssueEvent(event, format)
  );
});

webhooks.on(["pull_request.closed", "pull_request.reopened"], async (event) => {
  if (isDuplicateDelivery(event.id)) return;
  const eventName = `pull_request.${event.payload.action}`;
  const { format } = getDeliveryConfig(eventName);
  await dispatchNotification(
    eventName,
    event.payload.repository?.full_name,
    "pullRequests",
    formatPullRequestClosedEvent(event, format)
  );
});

webhooks.on("pull_request.opened", async (event) => {
  if (isDuplicateDelivery(event.id)) return;
  const eventName = "pull_request.opened";
  const { format } = getDeliveryConfig(eventName);
  await dispatchNotification(
    eventName,
    event.payload.repository?.full_name,
    "pullRequests",
    formatPullRequestOpenedEvent(event, format)
  );
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
  const eventName = "pull_request.merge_conflict";
  const { format } = getDeliveryConfig(eventName);
  await dispatchNotification(
    eventName,
    repository?.full_name,
    "pullRequests",
    formatMergeConflictEvent(pr, repository, format)
  );
});

webhooks.on("workflow_run.completed", async (event) => {
  if (isDuplicateDelivery(event.id)) return;
  const eventName = "workflow_run.completed";
  const { format } = getDeliveryConfig(eventName);
  await dispatchNotification(
    eventName,
    event.payload.repository?.full_name,
    "ci",
    formatWorkflowRunEvent(event, format)
  );
});

webhooks.on("deployment_status.created", async (event) => {
  if (isDuplicateDelivery(event.id)) return;
  const eventName = "deployment_status.created";
  const { format } = getDeliveryConfig(eventName);
  await dispatchNotification(
    eventName,
    event.payload.repository?.full_name,
    "deploys",
    formatDeploymentStatusEvent(event, format)
  );
});

webhooks.onError((error) => {
  console.error("Webhook handling failed:", error.message);
});
