import { config } from "../config.js";

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
