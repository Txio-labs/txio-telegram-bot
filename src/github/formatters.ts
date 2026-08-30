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

export function formatDependencyUpdateEvent(
  event: EmitterWebhookEvent<"pull_request">,
  format: string,
): { text: string; parseMode?: "HTML"; replyMarkup?: any } {
  const { pull_request: pr, repository } = event.payload;

  if (format === "plain_text") {
    const text = `📦 Dependency update in ${repository.full_name}\n#${pr.number} ${pr.title}\nby ${pr.user?.login ?? "unknown"}`;
    return { text, parseMode: undefined };
  }

  const htmlText =
    `📦 Dependency update in ${link(repository.html_url, repository.full_name)}\n` +
    `${link(pr.html_url, `#${pr.number} ${pr.title}`)}\n` +
    `by ${escapeHtml(pr.user?.login ?? "unknown")}`;

  return { text: htmlText, parseMode: "HTML" };
}

export function formatSecurityAlertEvent(
  event: EmitterWebhookEvent<"dependabot_alert">,
  format: string,
): { text: string; parseMode?: "HTML"; replyMarkup?: unknown } {
  const { alert, repository } = event.payload;

  const pkg = alert.security_vulnerability?.package ?? alert.dependency?.package;
  const packageName = pkg?.name ?? "unknown";
  const ecosystem = pkg?.ecosystem ?? "unknown";
  const severity = alert.security_advisory?.severity ?? alert.security_vulnerability?.severity ?? "unknown";
  const ghsaId = alert.security_advisory?.ghsa_id;
  const cveId = alert.security_advisory?.cve_id;
  const summary = alert.security_advisory?.summary;
  const vulnerableRange = alert.security_vulnerability?.vulnerable_version_range;
  const patchedVersion = alert.security_vulnerability?.first_patched_version?.identifier;
  const alertTitle = `#${alert.number} ${summary ?? ghsaId ?? "vulnerable dependency"}`;
  const idLine = ghsaId && cveId ? `${ghsaId} · ${cveId}` : ghsaId ?? cveId ?? "";

  if (format === "plain_text") {
    const text =
      `🔒 Security alert in ${repository.full_name}\n` +
      `${alertTitle}\n` +
      `Severity: ${severity} · Dependency: ${packageName} (${ecosystem})\n` +
      (vulnerableRange ? `Vulnerable range: ${vulnerableRange}\n` : "") +
      (patchedVersion ? `Patched in: ${patchedVersion}\n` : "") +
      `${alert.html_url}`;
    return { text, parseMode: undefined };
  }

  const htmlText =
    `🔒 Security alert in ${link(repository.html_url, repository.full_name)}\n` +
    `${link(alert.html_url, alertTitle)}\n` +
    `Severity: ${escapeHtml(severity)} · Dependency: ${escapeHtml(packageName)} (${escapeHtml(ecosystem)})\n` +
    (vulnerableRange ? `Vulnerable range: ${escapeHtml(vulnerableRange)}\n` : "") +
    (patchedVersion ? `Patched in: ${escapeHtml(patchedVersion)}\n` : "") +
    (idLine ? `Advisory: ${escapeHtml(idLine)}` : "");

  if (format === "inline_buttons") {
    const keyboard = new InlineKeyboard().url("View Alert", alert.html_url);
    return { text: htmlText, parseMode: "HTML", replyMarkup: keyboard };
  }

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

export const COMMENT_PREVIEW_LENGTH = 200;

export function truncateCommentBody(body: string): string {
  const normalized = body.replace(/\s+/g, " ").trim();
  return normalized.length > COMMENT_PREVIEW_LENGTH
    ? `${normalized.slice(0, COMMENT_PREVIEW_LENGTH)}…`
    : normalized;
}

export function formatCommentEvent({
  payload,
}: EmitterWebhookEvent<"issue_comment">): string {
  const { issue, comment, repository } = payload;
  const isPr = Boolean(issue.pull_request);
  const icon = isPr ? "💬" : "🗨️";
  const subject = isPr ? "Pull request" : "Issue";
  return (
    `${icon} Comment on ${subject} in ${link(repository.html_url, repository.full_name)}\n` +
    `${link(issue.html_url, `#${issue.number} ${issue.title}`)}\n` +
    `${escapeHtml(comment.user?.login ?? "unknown")}: ${escapeHtml(truncateCommentBody(comment.body ?? ""))}`
  );
}

export function formatWorkflowRunEvent(event: EmitterWebhookEvent<"workflow_run">): string | null;
export function formatWorkflowRunEvent(
  event: EmitterWebhookEvent<"workflow_run">,
  format: string,
): { text: string; parseMode?: "HTML"; replyMarkup?: any } | null;
export function formatWorkflowRunEvent(
  { payload }: EmitterWebhookEvent<"workflow_run">,
  format?: string,
): string | { text: string; parseMode?: "HTML"; replyMarkup?: any } | null {
  const { workflow_run: run, repository } = payload;
  if (run.status !== "completed") return null;
  const icon = run.conclusion === "success" ? "✅" : run.conclusion === "cancelled" ? "⚪" : "❌";

  if (format === "plain_text") {
    return {
      text: `${icon} CI ${run.conclusion} for ${repository.full_name}\n${run.name ?? "workflow"} on ${run.head_branch ?? "unknown"}`,
      parseMode: undefined,
    };
  }

  const htmlText =
    `${icon} CI ${run.conclusion} for ${link(repository.html_url, repository.full_name)}\n` +
    `${link(run.html_url, run.name ?? "workflow")} on ${escapeHtml(run.head_branch ?? "unknown")}`;

  if (format === undefined) return htmlText;

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

export function formatBranchCreatedEvent({
  payload,
}: EmitterWebhookEvent<"create">): string {
  const { ref, repository, sender } = payload;
  return (
    `🌿 Branch created in ${link(repository.html_url, repository.full_name)}\n` +
    `${escapeHtml(ref)} by ${escapeHtml(sender?.login ?? "unknown")}`
  );
}

export function formatBranchDeletedEvent({
  payload,
}: EmitterWebhookEvent<"delete">): string {
  const { ref, repository, sender } = payload;
  return (
    `🗑️ Branch deleted in ${link(repository.html_url, repository.full_name)}\n` +
    `${escapeHtml(ref)} by ${escapeHtml(sender?.login ?? "unknown")}`
  );
}

export function formatForcePushEvent({
  payload,
}: EmitterWebhookEvent<"push">): string {
  const { ref, repository, sender, compare } = payload;
  const branch = ref.replace(/^refs\/heads\//, "");
  return (
    `⚠️ Force push to ${escapeHtml(branch)} in ${link(repository.html_url, repository.full_name)}\n` +
    `${link(compare, "view changes")}\n` +
    `by ${escapeHtml(sender?.login ?? "unknown")}`
  );
}

export function formatReleaseEvent({
  payload,
}: EmitterWebhookEvent<"release">): string | null {
  const { release, repository } = payload;
  if (release.draft) return null;
  const icon = release.prerelease ? "🏷️" : "📦";
  const tagLabel = release.tag_name + (release.name ? ` — ${release.name}` : "");
  const lines = [
    `${icon} Release published in ${link(repository.html_url, repository.full_name)}`,
    `${link(release.html_url, tagLabel)}`,
  ];
  if (release.body) {
    lines.push(escapeHtml(truncateCommentBody(release.body)));
  }
  return lines.join("\n");
}
