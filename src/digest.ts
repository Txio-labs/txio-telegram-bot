import { config } from "./config.js";
import { githubGet, type GitHubRelease } from "./releases/github.js";
import { link } from "./github/formatters.js";
import { getState, updateState, type FirstTimer } from "./store.js";
import { sendMessage } from "./telegram/client.js";
import { escapeHtml } from "./utils/html.js";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const DIGEST_MAX_LENGTH = 3800;
const MAX_PRS_PER_REPO = 5;

export type MergedPr = { repo: string; number: number; title: string; url: string; author: string; mergedAt: string };
export type RepoWeek = { repo: string; merged: MergedPr[]; releases: Array<{ tag: string; url: string }> };

/** Repos covered by the weekly digest: tracked repos, else product repos. */
export function digestRepos(): string[] {
  const repos = config.staleReminder.repos.length > 0
    ? config.staleReminder.repos
    : (config.announce?.products ?? []).map((p) => p.repo);
  return [...new Set(repos)];
}

export async function collectRepoWeek(repo: string, since: number, fetchFn: typeof fetch = fetch): Promise<RepoWeek> {
  type Pull = { number: number; title: string; html_url: string; merged_at: string | null; user: { login: string; type?: string } | null };
  const pulls =
    (await githubGet<Pull[]>(`/repos/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=100`, fetchFn)) ?? [];
  const merged = pulls
    .filter((p) => p.merged_at && Date.parse(p.merged_at) >= since)
    .filter((p) => p.user?.type !== "Bot")
    .map((p) => ({
      repo,
      number: p.number,
      title: p.title,
      url: p.html_url,
      author: p.user?.login ?? "unknown",
      mergedAt: p.merged_at as string,
    }));
  const releases = ((await githubGet<GitHubRelease[]>(`/repos/${repo}/releases?per_page=10`, fetchFn)) ?? [])
    .filter((r) => !r.draft && r.published_at && Date.parse(r.published_at) >= since)
    .map((r) => ({ tag: r.tag_name, url: r.html_url }));
  return { repo, merged, releases };
}

function shortDate(time: number): string {
  return new Date(time).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

export function formatWeeklyDigest(weeks: RepoWeek[], firstTimers: FirstTimer[], now: number): string | null {
  const active = weeks.filter((w) => w.merged.length > 0 || w.releases.length > 0);
  if (active.length === 0 && firstTimers.length === 0) return null;

  const totalMerged = active.reduce((sum, w) => sum + w.merged.length, 0);
  const contributors = new Map<string, number>();
  for (const w of active) for (const pr of w.merged) contributors.set(pr.author, (contributors.get(pr.author) ?? 0) + 1);

  const header =
    `📊 <b>Week in Txio</b> (${shortDate(now - WEEK_MS)} – ${shortDate(now)})\n` +
    `${totalMerged} PR${totalMerged === 1 ? "" : "s"} merged by ${contributors.size} contributor${contributors.size === 1 ? "" : "s"}`;

  const sections: string[] = [];
  for (const w of active) {
    const lines = [`<b>${escapeHtml(w.repo)}</b>`];
    for (const r of w.releases) lines.push(`🚀 Released ${link(r.url, r.tag)}`);
    for (const pr of w.merged.slice(0, MAX_PRS_PER_REPO)) {
      lines.push(`• ${link(pr.url, `#${pr.number} ${pr.title}`)} by ${escapeHtml(pr.author)}`);
    }
    const hidden = w.merged.length - MAX_PRS_PER_REPO;
    if (hidden > 0) lines.push(`…and ${hidden} more`);
    sections.push(lines.join("\n"));
  }

  const ranked = [...contributors.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (ranked.length > 0) {
    sections.push(
      `<b>Thanks to</b>\n${ranked.map(([login, count]) => `${escapeHtml(login)} (${count})`).join(", ")}`,
    );
  }
  if (firstTimers.length > 0) {
    sections.push(
      `🎉 <b>First contributions</b>\n` +
        firstTimers.map((f) => `• ${escapeHtml(f.login)}: ${link(f.url, `${f.repo}#${f.number}`)}`).join("\n"),
    );
  }

  // Drop whole sections from the end until the message fits.
  let text = [header, ...sections].join("\n\n");
  while (text.length > DIGEST_MAX_LENGTH && sections.length > 0) {
    sections.pop();
    text = [header, ...sections, "…(trimmed; too much happened this week)"].join("\n\n");
  }
  return text;
}

export async function runWeeklyDigest(now = Date.now(), fetchFn: typeof fetch = fetch): Promise<boolean> {
  const since = now - WEEK_MS;
  const weeks: RepoWeek[] = [];
  for (const repo of digestRepos()) {
    try {
      weeks.push(await collectRepoWeek(repo, since, fetchFn));
    } catch (error) {
      console.warn(`[digest] ${repo} failed:`, error);
    }
  }
  const firstTimers = getState().firstTimers.filter((f) => Date.parse(f.at) >= since);
  const text = formatWeeklyDigest(weeks, firstTimers, now);
  if (!text) {
    console.log("[digest] quiet week, nothing to post");
    return false;
  }
  await sendMessage(config.weeklyDigest.chatId, text, config.weeklyDigest.threadId);
  return true;
}

// GitHub marks a contributor's first PR to a repo with these associations.
const FIRST_TIME = new Set(["FIRST_TIME_CONTRIBUTOR", "FIRST_TIMER"]);

export function isFirstContribution(authorAssociation: string | undefined): boolean {
  return !!authorAssociation && FIRST_TIME.has(authorAssociation);
}

export function formatShoutout(f: FirstTimer, title: string): string {
  return (
    `🎉 <b>First contribution!</b> ${escapeHtml(f.login)} just got ` +
    `${link(f.url, `${f.repo}#${f.number} ${title}`)} merged. Welcome to Txio, and thank you!`
  );
}

/** Records a merged first-time PR (for the digest) and thanks the author in the group. */
export async function recordFirstContribution(f: FirstTimer, title: string): Promise<void> {
  if (getState().firstTimers.some((x) => x.repo === f.repo && x.number === f.number)) return;
  await updateState((s) => void s.firstTimers.push(f));
  if (config.firstContributorShoutout) {
    await sendMessage(config.telegramChatId, formatShoutout(f, title));
  }
}
