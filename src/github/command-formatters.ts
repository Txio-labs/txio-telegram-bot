import type { RepoSummary, PullRequestDetail, CombinedStatus, CheckRun } from "./api.js";
import { escapeHtml } from "../utils/html.js";

function link(url: string, label: string): string {
  return `<a href="${escapeHtml(url)}">${escapeHtml(label)}</a>`;
}

export function formatRepoSummary(repo: RepoSummary): string {
  const lang = repo.language ? ` · ${escapeHtml(repo.language)}` : "";
  const desc = repo.description ? `\n${escapeHtml(repo.description)}` : "";
  return (
    `📊 ${link(repo.html_url, repo.full_name)}${desc}\n` +
    `⭐ ${repo.stargazers_count.toLocaleString()} stars · ` +
    `🍴 ${repo.forks_count.toLocaleString()} forks · ` +
    `📋 ${repo.open_issues_count} open issues · ` +
    `🔀 ${repo.openPullRequests} open PRs` +
    lang
  );
}

export function formatPullRequestDetail(
  pr: PullRequestDetail,
  status: CombinedStatus,
  checkRuns: CheckRun[],
): string {
  const stateLabel = pr.merged ? "merged" : pr.state;
  const icon = pr.merged ? "🎉" : pr.state === "open" ? "🟢" : "🔴";
  const draft = pr.draft ? " (draft)" : "";
  const author = pr.user?.login ?? "unknown";

  // Aggregate CI status from both commit status and check runs
  const ciState = combineCiStatus(status, checkRuns);
  const ciIcon =
    ciState === "success" ? "✅" :
    ciState === "failure" || ciState === "error" ? "❌" :
    ciState === "pending" ? "⏳" : "❓";
  const ciLabel = ciState === "success" ? "passing" :
    ciState === "failure" || ciState === "error" ? "failing" :
    ciState === "pending" ? "pending" : "unknown";

  return (
    `${icon} PR #${pr.number}${draft} — ${escapeHtml(pr.title)}\n` +
    `State: <b>${stateLabel}</b> · Author: ${escapeHtml(author)}\n` +
    `CI: ${ciIcon} ${ciLabel}` +
    (status.total_count > 0 ? ` (${status.total_count} checks)` : "") +
    `\n${link(pr.html_url, "View on GitHub")}`
  );
}

export function formatRepoNotFound(name: string): string {
  return (
    `❌ Repository "${escapeHtml(name)}" not found in the routing config.\n` +
    `Use a short name that matches a configured repo (e.g. "backend" for "txio-labs/txio-backend").`
  );
}

export function formatPrNotFound(repo: string, number: number): string {
  return `❌ PR #${number} not found in ${escapeHtml(repo)}.`;
}

export function formatApiError(message: string): string {
  return `⚠️ ${escapeHtml(message)}`;
}

function combineCiStatus(
  status: CombinedStatus,
  checkRuns: CheckRun[],
): string {
  // Check runs take priority if they exist
  if (checkRuns.length > 0) {
    const conclusions = checkRuns.map((cr) => cr.conclusion ?? cr.status);
    if (conclusions.some((c) => c === "failure" || c === "cancelled")) return "failure";
    if (conclusions.every((c) => c === "success")) return "success";
    if (conclusions.some((c) => c === "pending" || c === "in_progress" || c === "queued")) return "pending";
    return "success";
  }

  // Fall back to commit status — check state even when total_count is 0
  if (status.state === "pending") return "pending";
  if (status.total_count === 0) return "unknown";
  return status.state;
}
