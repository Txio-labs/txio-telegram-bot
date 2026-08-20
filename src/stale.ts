import { link } from "./github/formatters.js";
import { escapeHtml } from "./utils/html.js";

export const DAY_MS = 24 * 60 * 60 * 1000;
// Telegram hard-caps messages at 4096 characters; keep a safety margin for
// HTML entity expansion on top of the cap.
export const STALE_DIGEST_MAX_LENGTH = 3800;

export type StaleItem = {
  repoFullName: string;
  number: number;
  title: string;
  htmlUrl: string;
  updatedAt: string;
  isPullRequest: boolean;
  author: string | undefined;
};

export function isStale(updatedAt: string, now: Date, thresholdDays: number): boolean {
  const time = Date.parse(updatedAt);
  if (Number.isNaN(time)) return false;
  return time <= now.getTime() - thresholdDays * DAY_MS;
}

export function daysSince(updatedAt: string, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - Date.parse(updatedAt)) / DAY_MS));
}

// Lists every open issue and pull request for a repo in a single call: the
// GitHub REST /issues endpoint includes pull requests (tagged with a
// `pull_request` key), which also halves the rate-limit cost per repo.
export async function fetchOpenItems(
  repoFullName: string,
  token: string | undefined,
  fetchFn: typeof fetch = fetch,
): Promise<StaleItem[]> {
  const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const url = `https://api.github.com/repos/${repoFullName}/issues?state=open&per_page=100`;
  const res = await fetchFn(url, { headers });
  if (!res.ok) {
    throw new Error(`GitHub API returned ${res.status} ${res.statusText} for ${repoFullName}`);
  }
  const data = (await res.json()) as Array<{
    number: number;
    title: string;
    html_url: string;
    updated_at: string;
    pull_request?: unknown;
    user?: { login?: string };
  }>;
  return data
    .map((item) => ({
      repoFullName,
      number: item.number,
      title: item.title,
      htmlUrl: item.html_url,
      updatedAt: item.updated_at,
      isPullRequest: "pull_request" in item,
      author: item.user?.login,
    }))
    .filter((item) => !Number.isNaN(Date.parse(item.updatedAt)));
}

export type CollectStaleItemsOptions = {
  token?: string;
  now: Date;
  thresholdDays: number;
  fetchFn?: typeof fetch;
};

// Queries every tracked repo sequentially (avoids bursting the GitHub rate
// limit) and keeps only items with no activity past the threshold. A failure
// for one repo is logged and skipped so the rest of the job still completes.
export async function collectStaleItems(
  repos: string[],
  options: CollectStaleItemsOptions,
): Promise<StaleItem[]> {
  const stale: StaleItem[] = [];
  for (const repo of repos) {
    try {
      const items = await fetchOpenItems(repo, options.token, options.fetchFn);
      for (const item of items) {
        if (isStale(item.updatedAt, options.now, options.thresholdDays)) {
          stale.push(item);
        }
      }
    } catch (error) {
      console.error(`Stale check failed for ${repo}:`, (error as Error).message);
    }
  }
  return stale;
}

export function formatStaleItemLine(item: StaleItem, now: Date): string {
  const icon = item.isPullRequest ? "🔀" : "🐛";
  const days = daysSince(item.updatedAt, now);
  const author = item.author ? ` — by ${escapeHtml(item.author)}` : "";
  const suffix = `no activity for ${days} day${days === 1 ? "" : "s"}`;
  return `${icon} ${link(item.htmlUrl, `#${item.number} ${item.title}`)} — ${suffix}${author}`;
}

type DigestSection = { repo: string; lines: string[] };

function groupByRepo(items: StaleItem[], now: Date): DigestSection[] {
  const byRepo = new Map<string, StaleItem[]>();
  for (const item of items) {
    const list = byRepo.get(item.repoFullName) ?? [];
    list.push(item);
    byRepo.set(item.repoFullName, list);
  }
  return [...byRepo.entries()].map(([repo, repoItems]) => ({
    repo,
    lines: repoItems.map((item) => formatStaleItemLine(item, now)),
  }));
}

function buildDigestText(sections: DigestSection[], thresholdDays: number): string {
  const parts = [`⚠️ Stale items — no activity for ${thresholdDays} days or more`, ""];
  for (const section of sections) {
    parts.push(`<b>${escapeHtml(section.repo)}</b>`, ...section.lines, "");
  }
  return parts.join("\n").trimEnd();
}

// Renders one digest-style message for the given items, capped at
// STALE_DIGEST_MAX_LENGTH: if the digest is too long, trailing items are
// dropped and replaced with a "…and N more" footer.
export function formatStaleDigest(items: StaleItem[], now: Date, thresholdDays: number): string {
  const sections = groupByRepo(items, now);
  let removed = 0;
  let text = buildDigestText(sections, thresholdDays);
  while (text.length > STALE_DIGEST_MAX_LENGTH) {
    const last = sections[sections.length - 1];
    if (!last) break;
    last.lines.pop();
    removed += 1;
    if (last.lines.length === 0) sections.pop();
    text = buildDigestText(sections, thresholdDays);
  }
  if (removed > 0) {
    const footer = `\n…and ${removed} more stale item${removed === 1 ? "" : "s"} not shown`;
    text =
      text.length + footer.length <= STALE_DIGEST_MAX_LENGTH
        ? text + footer
        : text.slice(0, STALE_DIGEST_MAX_LENGTH - footer.length).trimEnd() + footer;
  }
  return text;
}
