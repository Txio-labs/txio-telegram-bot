import { Webhooks } from "@octokit/webhooks";
import { config, resolveDestination, labelMatchesAllowlist } from "../config.js";
import { prChangesRequestedNotifier } from "../notifications/prChangesRequested.js";
import { notifyChannel, sendMessage } from "../telegram/client.js";
import {
  formatBranchCreatedEvent,
  formatBranchDeletedEvent,
  formatCommentEvent,
  formatDependencyUpdateEvent,
  formatDeploymentStatusEvent,
  formatForcePushEvent,
  formatIssueEvent,
  formatMergeConflictEvent,
  formatPullRequestClosedEvent,
  formatPullRequestOpenedEvent,
  formatSecurityAlertEvent,
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

// Tracks PRs that are currently known to be conflicted.
// A PR is removed once it is no longer conflicted, allowing a future
// conflict on the same PR to trigger a new notification.
const conflictedPullRequests = new Set<string>();

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
    formatIssueEvent(event, format)
  );
  const payloadLabels = (event.payload.issue.labels ?? []).map((l) => l?.name).filter((n): n is string => typeof n === "string");
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
    const dest = resolveDestination(
      repoFullName,
      "pullRequests",
      config.telegramChatId,
      config.topicThreads.pullRequests,
    );
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
  const labels = event.payload.pull_request?.labels ?? [];
  const hasDependenciesLabel = labels.some((label: any) => label.name === "dependencies");
  const { text, parseMode, replyMarkup } = hasDependenciesLabel
    ? formatDependencyUpdateEvent(event, format)
    : formatPullRequestOpenedEvent(event, format);

  const repoFullName = event.payload.repository?.full_name;
  let targetChatId: string | number = config.telegramChatId;
  let threadId: number | undefined;
  let allowlist: string[] | undefined;

  if (channel === "topic_thread") {
    const dest = resolveDestination(
      repoFullName,
      "pullRequests",
      config.telegramChatId,
      config.topicThreads.pullRequests,
    );
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
  if (pr.mergeable !== null && pr.mergeable !== undefined) {
    return pr.mergeable === false;
  }

  await new Promise((resolve) => setTimeout(resolve, 4000));
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
  };

  if (config.githubToken) {
    headers.Authorization = `Bearer ${config.githubToken}`;
  }

  const res = await fetch(
    `https://api.github.com/repos/${repository.full_name}/pulls/${pr.number}`,
    { headers },
  );

  if (!res.ok) return false;

  const data = (await res.json()) as { mergeable: boolean | null };
  return data.mergeable === false;
}

webhooks.on(
  ["pull_request.opened", "pull_request.synchronize", "pull_request.reopened"],
  async (event) => {
    if (isDuplicateDelivery(event.id)) return;

    const { pull_request: pr, repository } = event.payload;
    const prKey = `${repository.full_name}#${pr.number}`;
    const conflicted = await isMergeConflicted(pr, repository);

    if (!conflicted) {
      conflictedPullRequests.delete(prKey);
      return;
    }

    // Already alerted for this conflict state.
    if (conflictedPullRequests.has(prKey)) return;

    conflictedPullRequests.add(prKey);

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

    const message = formatMergeConflictEvent(pr, repository);
    await sendMessage(dest.chatId, message);
  },
);

webhooks.on("pull_request.closed", async (event) => {
  if (isDuplicateDelivery(event.id)) return;

  const { pull_request: pr, repository } = event.payload;
  conflictedPullRequests.delete(`${repository.full_name}#${pr.number}`);
});

webhooks.on("issue_comment.created", async (event) => {
  if (isDuplicateDelivery(event.id)) return;
  const { issue, comment, repository } = event.payload;
  // Skip automation (e.g. other bots commenting) to avoid notification loops.
  if (comment.user?.type === "Bot") return;
  const isPr = Boolean(issue.pull_request);
  const { chatId, threadId } = resolveDestination(
    repository?.full_name,
    isPr ? "pullRequests" : "issues",
    config.telegramChatId,
    isPr ? config.topicThreads.pullRequests : config.topicThreads.issues,
  );
  await sendMessage(chatId, formatCommentEvent(event), threadId);
});

webhooks.on("pull_request_review.submitted", async (event) => {
  if (isDuplicateDelivery(event.id)) return;
  if (event.payload.review.state !== "changes_requested") return;
  
  await prChangesRequestedNotifier.dispatch(event.payload, {
    threadId: config.topicThreads.pullRequests,
    dmChatId: config.pullRequestChatId
  });
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
    formatDeploymentStatusEvent(event, format)
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

webhooks.on("dependabot_alert.created", async (event) => {
  if (isDuplicateDelivery(event.id)) return;
  const { channel, format } = config.securityAlert;
  const { text, parseMode, replyMarkup } = formatSecurityAlertEvent(event, format);

  const repoFullName = event.payload.repository?.full_name;
  let targetChatId: string | number = config.telegramChatId;
  let threadId: number | undefined;

  if (channel === "topic_thread") {
    const dest = resolveDestination(repoFullName, "security", config.telegramChatId, config.topicThreads.security);
    targetChatId = dest.chatId;
    threadId = dest.threadId;
  } else if (channel === "dm") {
    if (config.securityAlertChatId) {
      targetChatId = config.securityAlertChatId;
    }
  }

  await sendMessage(targetChatId, text, threadId, { parseMode, replyMarkup });
});

webhooks.onError((error) => {
  console.error("Webhook handling failed:", error.message);
});
