import { Webhooks } from "@octokit/webhooks";
import { config } from "../config.js";
import { notifyChannel, sendMessage } from "../telegram/client.js";
import {
  formatDeploymentStatusEvent,
  formatIssueEvent,
  formatMergeConflictEvent,
  formatPullRequestEvent,
  formatWorkflowRunEvent,
} from "./formatters.js";

export const webhooks = new Webhooks({ secret: config.githubWebhookSecret });

webhooks.on(["issues.opened", "issues.closed", "issues.reopened"], async (event) => {
  await notifyChannel(formatIssueEvent(event), config.topicThreads.issues);
});

webhooks.on(["pull_request.opened", "pull_request.closed", "pull_request.reopened"], async (event) => {
  const message = formatPullRequestEvent(event);
  if (config.pullRequestChatId) {
    await sendMessage(config.pullRequestChatId, message);
  } else {
    await notifyChannel(message);
  }
});

// GitHub computes `mergeable` asynchronously, so it's often null on the
// webhook payload itself. Give it a few seconds, then check via the REST
// API before deciding whether to alert.
async function isMergeConflicted(
  pr: { number: number; mergeable?: boolean | null },
  repository: { full_name: string },
): Promise<boolean> {
  if (pr.mergeable !== null && pr.mergeable !== undefined) return pr.mergeable === false;

  await new Promise((resolve) => setTimeout(resolve, 4000));
  const res = await fetch(`https://api.github.com/repos/${repository.full_name}/pulls/${pr.number}`, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!res.ok) return false;
  const data = (await res.json()) as { mergeable: boolean | null };
  return data.mergeable === false;
}

webhooks.on(["pull_request.opened", "pull_request.synchronize", "pull_request.reopened"], async (event) => {
  const { pull_request: pr, repository } = event.payload;
  if (!(await isMergeConflicted(pr, repository))) return;
  const message = formatMergeConflictEvent(pr, repository);
  const target = config.pullRequestChatId ?? config.telegramChatId;
  await sendMessage(target, message);
});

webhooks.on("workflow_run.completed", async (event) => {
  const message = formatWorkflowRunEvent(event);
  if (message) await notifyChannel(message, config.topicThreads.ci);
});

webhooks.on("deployment_status.created", async (event) => {
  await notifyChannel(formatDeploymentStatusEvent(event), config.topicThreads.deploys);
});

webhooks.onError((error) => {
  console.error("Webhook handling failed:", error.message);
});
