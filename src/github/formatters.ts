import type { EmitterWebhookEvent } from "@octokit/webhooks";
import { InlineKeyboard } from "grammy";
import { escapeHtml } from "../utils/html.js";

export function link(url: string, label: string): string {
  return `<a href="${escapeHtml(url)}">${escapeHtml(label)}</a>`;
}

export function formatIssueEvent(
  { payload }: EmitterWebhookEvent<"issues">,
  format: string
): { text: string; parseMode?: "HTML"; replyMarkup?: any } {
  const { action, issue, repository } = payload;
  const icon = action === "opened" ? "🆕" : action === "reopened" ? "🔁" : "✅";

  if (format === "plain_text") {
    const text = `${icon} Issue ${action} in ${repository.full_name}\n#${issue.number} ${issue.title}\nby ${issue.user?.login ?? "unknown"}`;
    return { text, parseMode: undefined };
  }

  const htmlText =
    `${icon} Issue ${action} in ${link(repository.html_url, repository.full_name)}\n` +
    `${link(issue.html_url, `#${issue.number} ${issue.title}`)}\n` +
    `by ${escapeHtml(issue.user?.login ?? "unknown")}`;

  if (format === "inline_buttons") {
    const keyboard = new InlineKeyboard().url("View Issue", issue.html_url);
    return { text: htmlText, parseMode: "HTML", replyMarkup: keyboard };
  }

  return { text: htmlText, parseMode: "HTML" };
}

export function formatPullRequestClosedEvent(
  event: EmitterWebhookEvent<"pull_request">,
  format: string,
): { text: string; parseMode?: "HTML"; replyMarkup?: unknown } {
  const { action, pull_request: pr, repository } = event.payload;
  const merged = action === "closed" && pr.merged;
  const label = merged ? "merged" : action;
  const icon = merged ? "🎉" : action === "reopened" ? "🔁" : "❌";

  if (format === "plain_text") {
    const text = `${icon} Pull request ${label} in ${repository.full_name}\n#${pr.number} ${pr.title}\nby ${pr.user?.login ?? "unknown"}`;
    return { text, parseMode: undefined };
  }

  const htmlText =
    `${icon} Pull request ${label} in ${link(repository.html_url, repository.full_name)}\n` +
    `${link(pr.html_url, `#${pr.number} ${pr.title}`)}\n` +
    `by ${escapeHtml(pr.user?.login ?? "unknown")}`;

  if (format === "inline_buttons") {
    const keyboard = new InlineKeyboard().url("View Pull Request", pr.html_url);
    return { text: htmlText, parseMode: "HTML", replyMarkup: keyboard };
  }

  return { text: htmlText, parseMode: "HTML" };
}

export function formatPullRequestOpenedEvent(
  event: EmitterWebhookEvent<"pull_request">,
  format: string
): { text: string; parseMode?: "HTML"; replyMarkup?: any } {
  const { pull_request: pr, repository } = event.payload;

  if (format === "plain_text") {
    const text = `🆕 Pull request opened in ${repository.full_name}\n#${pr.number} ${pr.title}\nby ${pr.user?.login ?? "unknown"}`;
    return { text, parseMode: undefined };
  }

  const htmlText =
    `🆕 Pull request opened in ${link(repository.html_url, repository.full_name)}\n` +
    `${link(pr.html_url, `#${pr.number} ${pr.title}`)}\n` +
    `by ${escapeHtml(pr.user?.login ?? "unknown")}`;

  if (format === "inline_buttons") {
    const keyboard = new InlineKeyboard().url("View Pull Request", pr.html_url);
    return { text: htmlText, parseMode: "HTML", replyMarkup: keyboard };
  }

  // format === "markdown_summary" or default
  return { text: htmlText, parseMode: "HTML" };
}

export function formatMergeConflictEvent(
  pr: { html_url: string; number: number; title: string },
  repository: { html_url: string; full_name: string },
  format: string
): { text: string; parseMode?: "HTML"; replyMarkup?: any } {
  if (format === "plain_text") {
    const text = `⚠️ Merge conflict on ${repository.full_name}\n#${pr.number} ${pr.title} can't be merged — needs to be updated with the base branch.`;
    return { text, parseMode: undefined };
  }

  const htmlText =
    `⚠️ Merge conflict on ${link(repository.html_url, repository.full_name)}\n` +
    `${link(pr.html_url, `#${pr.number} ${pr.title}`)} can't be merged — needs to be updated with the base branch.`;

  if (format === "inline_buttons") {
    const keyboard = new InlineKeyboard().url("Resolve Conflict", pr.html_url);
    return { text: htmlText, parseMode: "HTML", replyMarkup: keyboard };
  }

  return { text: htmlText, parseMode: "HTML" };
}

export function formatWorkflowRunEvent(
  { payload }: EmitterWebhookEvent<"workflow_run">,
  format: string
): { text: string; parseMode?: "HTML"; replyMarkup?: any } | null {
  const { workflow_run: run, repository } = payload;
  if (run.status !== "completed") return null;
  const icon = run.conclusion === "success" ? "✅" : run.conclusion === "cancelled" ? "⚪" : "❌";
  
  if (format === "plain_text") {
    const text = `${icon} CI ${run.conclusion} for ${repository.full_name}\n${run.name ?? "workflow"} on ${run.head_branch ?? "unknown"}`;
    return { text, parseMode: undefined };
  }

  const htmlText =
    `${icon} CI ${run.conclusion} for ${link(repository.html_url, repository.full_name)}\n` +
    `${link(run.html_url, run.name ?? "workflow")} on ${escapeHtml(run.head_branch ?? "unknown")}`;

  if (format === "inline_buttons") {
    const keyboard = new InlineKeyboard().url("View Logs", run.html_url);
    return { text: htmlText, parseMode: "HTML", replyMarkup: keyboard };
  }

  return { text: htmlText, parseMode: "HTML" };
}

export function formatDeploymentStatusEvent(
  { payload }: EmitterWebhookEvent<"deployment_status">,
  format: string
): { text: string; parseMode?: "HTML"; replyMarkup?: any } {
  const { deployment_status: status, deployment, repository } = payload;
  const icon = status.state === "success" ? "🚀" : status.state === "failure" || status.state === "error" ? "❌" : "⏳";

  if (format === "plain_text") {
    const text = `${icon} Deploy ${status.state} — ${deployment.environment} (${repository.full_name})\n` + (status.log_url ? `Logs: ${status.log_url}` : "");
    return { text, parseMode: undefined };
  }

  const htmlText =
    `${icon} Deploy ${status.state} — ${escapeHtml(deployment.environment)} (${link(
      repository.html_url,
      repository.full_name,
    )})\n` + (status.log_url ? link(status.log_url, "logs") : "");

  if (format === "inline_buttons" && status.log_url) {
    const keyboard = new InlineKeyboard().url("View Logs", status.log_url);
    return { text: htmlText, parseMode: "HTML", replyMarkup: keyboard };
  }

  return { text: htmlText, parseMode: "HTML" };
}
