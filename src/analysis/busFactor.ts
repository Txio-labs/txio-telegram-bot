import { escapeHtml } from "../utils/html.js";

export type AuthorshipCommit = { author: string; files: string[] };
export type BusFactorRisk = {
  path: string;
  dominantAuthor: string;
  dominantCommits: number;
  totalCommits: number;
  concentrationPercent: number;
};
export type BusFactorOptions = { thresholdPercent: number; minCommits: number; topFiles: number };

const BOT_AUTHOR_PATTERN = /\[bot\]|bot$|dependabot|renovate/i;

export function calculateAuthorshipConcentration(
  commits: AuthorshipCommit[],
  options: BusFactorOptions,
): BusFactorRisk[] {
  const authorsByFile = new Map<string, Map<string, number>>();
  for (const commit of commits) {
    if (!commit.author || BOT_AUTHOR_PATTERN.test(commit.author)) continue;
    for (const path of new Set(commit.files)) {
      const authors = authorsByFile.get(path) ?? new Map<string, number>();
      authors.set(commit.author, (authors.get(commit.author) ?? 0) + 1);
      authorsByFile.set(path, authors);
    }
  }

  return [...authorsByFile.entries()]
    .map(([path, authors]) => {
      const rankedAuthors = [...authors.entries()].sort(
        ([authorA, countA], [authorB, countB]) => countB - countA || authorA.localeCompare(authorB),
      );
      const [dominantAuthor, dominantCommits] = rankedAuthors[0] ?? ["", 0];
      const totalCommits = [...authors.values()].reduce((sum, count) => sum + count, 0);
      return { path, dominantAuthor, dominantCommits, totalCommits, concentrationPercent: (dominantCommits / totalCommits) * 100 };
    })
    .filter((risk) => risk.totalCommits >= options.minCommits && risk.concentrationPercent >= options.thresholdPercent)
    .sort((riskA, riskB) => riskB.concentrationPercent - riskA.concentrationPercent || riskB.totalCommits - riskA.totalCommits || riskA.path.localeCompare(riskB.path))
    .slice(0, options.topFiles);
}

type GitHubCommitSummary = {
  sha: string;
  author?: { login?: string } | null;
  commit: { author?: { name?: string; email?: string } | null };
};
type GitHubCommitDetail = GitHubCommitSummary & {
  files?: Array<{ filename: string; status?: string; previous_filename?: string }>;
};

function githubHeaders(token: string | undefined): Record<string, string> {
  return { Accept: "application/vnd.github+json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

function commitAuthor(commit: GitHubCommitSummary): string {
  return commit.author?.login ?? commit.commit.author?.name ?? commit.commit.author?.email ?? "unknown";
}

export async function fetchBusFactorRisks(
  repoFullName: string,
  options: BusFactorOptions & { token?: string; recentCommits: number; fetchFn?: typeof fetch },
): Promise<BusFactorRisk[]> {
  const fetchFn = options.fetchFn ?? fetch;
  const headers = githubHeaders(options.token);
  const response = await fetchFn(`https://api.github.com/repos/${repoFullName}/commits?per_page=${Math.min(options.recentCommits, 100)}`, { headers });
  if (!response.ok) throw new Error(`GitHub API returned ${response.status} ${response.statusText} for ${repoFullName}`);

  const summaries = (await response.json()) as GitHubCommitSummary[];
  const commits: AuthorshipCommit[] = [];
  const renameAliases = new Map<string, string>();
  for (const summary of summaries.slice(0, options.recentCommits)) {
    const detailResponse = await fetchFn(`https://api.github.com/repos/${repoFullName}/commits/${summary.sha}`, { headers });
    if (!detailResponse.ok) throw new Error(`GitHub API returned ${detailResponse.status} ${detailResponse.statusText} for ${repoFullName} commit ${summary.sha}`);
    const detail = (await detailResponse.json()) as GitHubCommitDetail;
    const files = (detail.files ?? []).map((file) => {
      const currentPath = renameAliases.get(file.filename) ?? file.filename;
      if (file.status === "renamed" && file.previous_filename) renameAliases.set(file.previous_filename, currentPath);
      return currentPath;
    });
    commits.push({ author: commitAuthor(detail), files });
  }
  return calculateAuthorshipConcentration(commits, options);
}

export function formatBusFactorDigest(risksByRepo: Map<string, BusFactorRisk[]>, topFiles: number): string {
  const lines = ["⚠️ <b>Weekly bus-factor report</b>", ""];
  for (const [repo, risks] of risksByRepo) {
    if (risks.length === 0) continue;
    lines.push(`<b>${escapeHtml(repo)}</b>`);
    for (const risk of risks.slice(0, topFiles)) {
      lines.push(`• <code>${escapeHtml(risk.path)}</code> — ${Math.round(risk.concentrationPercent)}% (${risk.dominantCommits}/${risk.totalCommits}) by ${escapeHtml(risk.dominantAuthor)}`);
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}