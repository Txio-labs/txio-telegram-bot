import { config } from "../config.js";
import { listOpenIssuesByLabel, type GitHubIssueListItem } from "../github/api.js";
import { link } from "../github/formatters.js";
import { escapeHtml } from "../utils/html.js";

export const CURATED_ISSUE_LIMIT = 10;

export type CuratedIssueCommand = "goodfirstissue" | "help-wanted";

export const curatedIssueCommands: Record<CuratedIssueCommand, { label: string; title: string }> = {
  goodfirstissue: { label: "good-first-issue", title: "good first issue" },
  "help-wanted": { label: "help-wanted", title: "help wanted" },
};

function normalizeRepo(repo: string): string {
  return repo.trim().replace(/^https:\/\/github\.com\//i, "").replace(/\/$/, "").toLowerCase();
}

export function resolveIssueCommandRepo(repoArg: string | undefined, trackedRepos = config.staleReminder.repos): string | undefined {
  const repos = trackedRepos.map(normalizeRepo);
  if (repoArg?.trim()) return normalizeRepo(repoArg);
  return repos[0];
}

export function isTrackedRepo(repoFullName: string, trackedRepos = config.staleReminder.repos): boolean {
  const repos = trackedRepos.map(normalizeRepo);
  return repos.length === 0 || repos.includes(normalizeRepo(repoFullName));
}

export function formatCuratedIssuesMessage(params: {
  repoFullName: string;
  label: string;
  title: string;
  issues: GitHubIssueListItem[];
  truncated: boolean;
}): string {
  const { repoFullName, label, title, issues, truncated } = params;
  const repoLink = link(`https://github.com/${repoFullName}`, repoFullName);
  if (issues.length === 0) {
    return `No open issues currently labeled <code>${escapeHtml(label)}</code> in ${repoLink}.`;
  }

  const lines = issues
    .slice(0, CURATED_ISSUE_LIMIT)
    .map((issue) => `• ${link(issue.htmlUrl, `#${issue.number} ${issue.title}`)}`);
  const moreLink = link(
    `https://github.com/${repoFullName}/issues?q=is%3Aissue+is%3Aopen+label%3A${encodeURIComponent(label)}`,
    "See more on GitHub",
  );
  return [
    `Open ${escapeHtml(title)} issues in ${repoLink}:`,
    ...lines,
    ...(truncated ? [`…and more. ${moreLink}.`] : []),
  ].join("\n");
}

export async function buildCuratedIssuesReply(command: CuratedIssueCommand, repoArg?: string): Promise<string> {
  const repoFullName = resolveIssueCommandRepo(repoArg);
  const commandConfig = curatedIssueCommands[command];
  if (!repoFullName) {
    return `Please provide a repo, e.g. /${command} Txio-labs/txio-telegram-bot.`;
  }
  if (!isTrackedRepo(repoFullName)) {
    return `Repo <code>${escapeHtml(repoFullName)}</code> is not tracked by this bot.`;
  }

  const issues = await listOpenIssuesByLabel(repoFullName, commandConfig.label, {
    perPage: CURATED_ISSUE_LIMIT + 1,
  });
  return formatCuratedIssuesMessage({
    repoFullName,
    label: commandConfig.label,
    title: commandConfig.title,
    issues: issues.slice(0, CURATED_ISSUE_LIMIT),
    truncated: issues.length > CURATED_ISSUE_LIMIT,
  });
}
