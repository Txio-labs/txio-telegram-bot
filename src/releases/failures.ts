import { config, resolveDestination } from "../config.js";
import { fetchRelease, fetchRunJobs, type WorkflowRun } from "./github.js";
import { link } from "../github/formatters.js";
import type { Product } from "../products.js";
import { sendMessage } from "../telegram/client.js";
import { escapeHtml } from "../utils/html.js";

export type FailedJob = { name: string; conclusion: string | null; html_url: string };

export function formatReleaseFailure(
  product: Product,
  run: WorkflowRun,
  failedJobs: FailedJob[],
  releaseUrl: string | null,
): string {
  const tag = run.head_branch ?? "unknown tag";
  const lines = [`🚨 <b>${escapeHtml(`${product.name} release ${tag} failed`)}</b>`];
  if (failedJobs.length > 0) {
    lines.push(
      "",
      "Failed jobs:",
      ...failedJobs.map((job) => `• ${link(job.html_url, job.name)} (${escapeHtml(job.conclusion ?? "failed")})`),
    );
  }
  if (releaseUrl) {
    lines.push(
      "",
      `⚠️ The ${link(releaseUrl, "release")} is already public with some installers missing. ` +
        "It was not announced. Re-run the failed jobs, or delete the release.",
    );
  } else {
    lines.push("", "Nothing was published, and nothing was announced.");
  }
  lines.push("", link(run.html_url, "Open the workflow run"));
  return lines.join("\n");
}

/** Tells the team (CI topic) which platform builds broke a release. */
export async function alertReleaseFailure(
  product: Product,
  run: WorkflowRun,
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  let failedJobs: FailedJob[] = [];
  let releaseUrl: string | null = null;
  try {
    failedJobs = (await fetchRunJobs(product.repo, run.id, fetchFn)).filter(
      (job) => job.conclusion === "failure" || job.conclusion === "timed_out",
    );
  } catch (error) {
    console.warn(`[release-failure] could not list jobs for run ${run.id}:`, error);
  }
  if (run.head_branch) {
    try {
      const release = await fetchRelease(product.repo, run.head_branch, fetchFn);
      if (release && !release.draft) releaseUrl = release.html_url;
    } catch (error) {
      console.warn(`[release-failure] could not look up release ${run.head_branch}:`, error);
    }
  }
  const { chatId, threadId } = resolveDestination(product.repo, "ci", config.telegramChatId, config.topicThreads.ci);
  await sendMessage(chatId, formatReleaseFailure(product, run, failedJobs, releaseUrl), threadId);
}
