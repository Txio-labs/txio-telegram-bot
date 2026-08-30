import { config } from "../config.js";

const API_BASE = "https://api.github.com";

export class GitHubApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(`GitHub API ${status}: ${message}`);
    this.name = "GitHubApiError";
    this.status = status;
  }
}

function authHeaders(): Record<string, string> {
  // Optional: unauthenticated requests work but share the per-IP 60 req/hr
  // quota, so a read-only token stretches that for the command surface.
  const token = config.githubToken || process.env.GITHUB_TOKEN;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function ghFetch<T>(path: string): Promise<{ data: T; linkHeader: string | null }> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...authHeaders(),
      },
    });
  } catch (err) {
    throw new GitHubApiError(0, `network error: ${(err as Error).message}`);
  }
  if (!res.ok) {
    throw new GitHubApiError(res.status, res.statusText || "request failed");
  }
  const data = (await res.json()) as T;
  return { data, linkHeader: res.headers.get("link") };
}

/** Pulls the last-page number out of a Link header, e.g. contributors count. */
export function lastPageFromLinkHeader(linkHeader: string | null): number | null {
  if (!linkHeader) return null;
  const match = linkHeader.match(/[?&]page=(\d+)>;\s*rel="last"/);
  return match ? Number(match[1]) : null;
}

export type GitHubIssueListItem = {
  number: number;
  title: string;
  htmlUrl: string;
};

export type ListOpenIssuesByLabelOptions = {
  token?: string;
  fetchFn?: typeof fetch;
  perPage?: number;
};

export async function listOpenIssuesByLabel(
  repoFullName: string,
  label: string,
  options: ListOpenIssuesByLabelOptions = {},
): Promise<GitHubIssueListItem[]> {
  const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
  const token = options.token ?? config.githubToken;
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const perPage = options.perPage ?? 11;
  const params = new URLSearchParams({
    state: "open",
    labels: label,
    per_page: String(perPage),
  });
  const res = await (options.fetchFn ?? fetch)(
    `https://api.github.com/repos/${repoFullName}/issues?${params.toString()}`,
    { headers },
  );

  if (!res.ok) {
    throw new Error(`GitHub API returned ${res.status} ${res.statusText} for ${repoFullName}`);
  }

  const data = (await res.json()) as Array<{
    number: number;
    title: string;
    html_url: string;
    pull_request?: unknown;
  }>;

  return data
    .filter((item) => !("pull_request" in item))
    .map((item) => ({
      number: item.number,
      title: item.title,
      htmlUrl: item.html_url,
    }));
}

export interface RepoStats {
  openIssues: number | string;
  openPullRequests: number | string;
  contributors: number | string;
}

export async function getRepoStats(repo: string): Promise<RepoStats> {
  const [repoRes, pullsRes, contributorsRes] = await Promise.all([
    ghFetch<{ open_issues_count: number }>(`/repos/${repo}`),
    ghFetch<unknown[]>(`/repos/${repo}/pulls?state=open&per_page=100`),
    ghFetch<unknown[]>(`/repos/${repo}/contributors?per_page=1&anon=true`),
  ]);

  // open_issues_count includes PRs; subtract the open PR count for the
  // issues-only figure people expect from "open issues". When the PR list
  // is capped we can't subtract reliably, so fall back to the raw count
  // with a "+" marker.
  const openPullRequests = pullsRes.data.length === 100 ? "100+" : pullsRes.data.length;
  const openIssuesRaw = repoRes.data.open_issues_count;
  const openIssues =
    typeof openPullRequests === "number"
      ? Math.max(openIssuesRaw - openPullRequests, 0)
      : `${openIssuesRaw}+`;

  const contributorPages = lastPageFromLinkHeader(contributorsRes.linkHeader);
  const contributors =
    contributorsRes.data.length === 0
      ? 0
      : contributorPages
        ? `${contributorPages}+`
        : contributorsRes.data.length;

  return { openIssues, openPullRequests, contributors };
}
