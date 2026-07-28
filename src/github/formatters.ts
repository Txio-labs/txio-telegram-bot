import type { EmitterWebhookEvent } from "@octokit/webhooks";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function link(url: string, label: string): string {
  return `<a href="${url}">${escapeHtml(label)}</a>`;
}

export function formatIssueEvent({ payload }: EmitterWebhookEvent<"issues">): string {
  const { action, issue, repository } = payload;
  const icon = action === "opened" ? "🆕" : action === "reopened" ? "🔁" : "✅";
  return (
    `${icon} Issue ${action} in ${link(repository.html_url, repository.full_name)}\n` +
    `${link(issue.html_url, `#${issue.number} ${issue.title}`)}\n` +
    `by ${escapeHtml(issue.user?.login ?? "unknown")}`
  );
}

export function formatPullRequestEvent({
  payload,
}: EmitterWebhookEvent<"pull_request">): string {
  const { action, pull_request: pr, repository } = payload;
  const merged = action === "closed" && pr.merged;
  const label = merged ? "merged" : action;
  const icon = action === "opened" ? "🆕" : merged ? "🎉" : action === "reopened" ? "🔁" : "❌";
  return (
    `${icon} Pull request ${label} in ${link(repository.html_url, repository.full_name)}\n` +
    `${link(pr.html_url, `#${pr.number} ${pr.title}`)}\n` +
    `by ${escapeHtml(pr.user?.login ?? "unknown")}`
  );
}

export function formatWorkflowRunEvent({
  payload,
}: EmitterWebhookEvent<"workflow_run">): string | null {
  const { workflow_run: run, repository } = payload;
  if (run.status !== "completed") return null;
  const icon = run.conclusion === "success" ? "✅" : run.conclusion === "cancelled" ? "⚪" : "❌";
  return (
    `${icon} CI ${run.conclusion} for ${link(repository.html_url, repository.full_name)}\n` +
    `${link(run.html_url, run.name ?? "workflow")} on ${escapeHtml(run.head_branch ?? "unknown")}`
  );
}

export function formatDeploymentStatusEvent({
  payload,
}: EmitterWebhookEvent<"deployment_status">): string {
  const { deployment_status: status, deployment, repository } = payload;
  const icon = status.state === "success" ? "🚀" : status.state === "failure" || status.state === "error" ? "❌" : "⏳";
  return (
    `${icon} Deploy ${status.state} — ${escapeHtml(deployment.environment)} (${link(
      repository.html_url,
      repository.full_name,
    )})\n` + (status.log_url ? link(status.log_url, "logs") : "")
  );
}
