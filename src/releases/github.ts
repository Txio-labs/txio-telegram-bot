import { config } from "../config.js";

export class GitHubFetchError extends Error {}

export type GitHubRelease = {
  tag_name: string;
  name: string | null;
  html_url: string;
  draft: boolean;
  prerelease: boolean;
  published_at: string | null;
  assets: Array<{ name: string; browser_download_url: string }>;
};

export type WorkflowRun = {
  id: number;
  name: string | null;
  head_branch: string | null;
  status: string | null;
  conclusion: string | null;
  html_url: string;
  run_started_at?: string | null;
  created_at?: string;
};

function headers(): Record<string, string> {
  const result: Record<string, string> = { Accept: "application/vnd.github+json" };
  if (config.githubToken) result.Authorization = `Bearer ${config.githubToken}`;
  return result;
}

/** GET a GitHub REST path. Returns null on 404, throws on other errors. */
export async function githubGet<T>(path: string, fetchFn: typeof fetch = fetch): Promise<T | null> {
  const res = await fetchFn(`https://api.github.com${path}`, {
    headers: headers(),
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new GitHubFetchError(`GitHub API returned ${res.status} ${res.statusText} for ${path}`);
  }
  return (await res.json()) as T;
}

export function fetchRelease(repo: string, tag: string, fetchFn?: typeof fetch) {
  return githubGet<GitHubRelease>(`/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`, fetchFn);
}

/** Latest published, non-prerelease release. */
export function fetchLatestRelease(repo: string, fetchFn?: typeof fetch) {
  return githubGet<GitHubRelease>(`/repos/${repo}/releases/latest`, fetchFn);
}

export async function fetchRecentRuns(repo: string, fetchFn?: typeof fetch): Promise<WorkflowRun[]> {
  const data = await githubGet<{ workflow_runs: WorkflowRun[] }>(`/repos/${repo}/actions/runs?per_page=30`, fetchFn);
  return data?.workflow_runs ?? [];
}

export async function fetchRunJobs(
  repo: string,
  runId: number,
  fetchFn?: typeof fetch,
): Promise<Array<{ name: string; conclusion: string | null; html_url: string }>> {
  const data = await githubGet<{ jobs: Array<{ name: string; conclusion: string | null; html_url: string }> }>(
    `/repos/${repo}/actions/runs/${runId}/jobs?per_page=50`,
    fetchFn,
  );
  return data?.jobs ?? [];
}

export async function fetchCommitMessages(
  repo: string,
  base: string,
  head: string,
  fetchFn?: typeof fetch,
): Promise<string[]> {
  const compare = await githubGet<{ commits: Array<{ commit: { message: string } }> }>(
    `/repos/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`,
    fetchFn,
  );
  // The compare API lists oldest first; callers show newest first.
  return (compare?.commits ?? []).map((c) => c.commit.message).reverse();
}
