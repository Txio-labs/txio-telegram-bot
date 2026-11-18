import { schedule, validate } from "node-cron";
import { config } from "./config.js";
import { runWeeklyDigest } from "./digest.js";
import { pollReleases } from "./releases/poller.js";

type Stoppable = { stop: () => void };
const running: Stoppable[] = [];

function every(minutes: number, name: string, task: () => Promise<unknown>, firstDelayMs: number): void {
  if (minutes <= 0) return;
  const runTask = () => task().catch((error) => console.error(`[jobs] ${name} failed:`, error));
  const first = setTimeout(runTask, firstDelayMs);
  const timer = setInterval(runTask, minutes * 60_000);
  running.push({ stop: () => (clearTimeout(first), clearInterval(timer)) });
  console.log(`[jobs] ${name} every ${minutes} min`);
}

/** Starts the release poller, weekly digest and keep-alive ping. */
export function startJobs(): void {
  if (running.length > 0) return;

  const pollMinutes = config.announce?.pollMinutes ?? 0;
  // First poll shortly after boot catches releases missed while asleep.
  every(pollMinutes, "release poll", () => pollReleases(), 30_000);

  const { cron } = config.weeklyDigest;
  if (cron && validate(cron)) {
    const job = schedule(cron, () => {
      runWeeklyDigest().catch((error) => console.error("[jobs] weekly digest failed:", error));
    });
    running.push(job);
    console.log(`[jobs] weekly digest scheduled (cron: ${cron})`);
  } else if (cron) {
    console.error(`Invalid WEEKLY_DIGEST_CRON "${cron}"; weekly digest disabled`);
  }

  // Inbound requests keep a Render free instance awake; ping our public URL.
  every(
    config.keepAliveMinutes,
    "keep-alive ping",
    async () => {
      const res = await fetch(`${config.publicUrl}/healthz`, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) console.warn(`[jobs] keep-alive got HTTP ${res.status}`);
    },
    60_000,
  );
}

export function stopJobs(): void {
  while (running.length > 0) running.pop()?.stop();
}
