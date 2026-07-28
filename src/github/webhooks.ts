import { Webhooks } from "@octokit/webhooks";
import { config } from "../config.js";
import { notifyChannel, sendMessage } from "../telegram/client.js";
import {
  formatDeploymentStatusEvent,
  formatIssueEvent,
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
