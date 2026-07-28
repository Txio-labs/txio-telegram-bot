import { Webhooks } from "@octokit/webhooks";
import { config } from "../config.js";
import { notifyChannel } from "../telegram/client.js";
import {
  formatDeploymentStatusEvent,
  formatIssueEvent,
  formatPullRequestEvent,
  formatWorkflowRunEvent,
} from "./formatters.js";

export const webhooks = new Webhooks({ secret: config.githubWebhookSecret });

webhooks.on(["issues.opened", "issues.closed", "issues.reopened"], async (event) => {
  await notifyChannel(formatIssueEvent(event));
});

webhooks.on(["pull_request.opened", "pull_request.closed", "pull_request.reopened"], async (event) => {
  await notifyChannel(formatPullRequestEvent(event));
});

webhooks.on("workflow_run.completed", async (event) => {
  const message = formatWorkflowRunEvent(event);
  if (message) await notifyChannel(message);
});

webhooks.on("deployment_status.created", async (event) => {
  await notifyChannel(formatDeploymentStatusEvent(event));
});

webhooks.onError((error) => {
  console.error("Webhook handling failed:", error.message);
});
