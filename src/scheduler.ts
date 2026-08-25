import { schedule, validate } from "node-cron";
import { config, resolveDestination } from "./config.js";
import { collectStaleItems, formatStaleDigest } from "./stale.js";
import type { StaleItem } from "./stale.js";
import { sendMessage } from "./telegram/client.js";
import { fetchBusFactorRisks, formatBusFactorDigest } from "./analysis/busFactor.js";

// Single job instance so hot reloads (tsx watch, redeploys) never register a
// second timer — the schedule itself is stateless.
let staleJob: ReturnType<typeof schedule> | null = null;
let busFactorJob: ReturnType<typeof schedule> | null = null;

export function startScheduler(): void {
  if (staleJob || busFactorJob) {
    console.log("Stale reminder scheduler already started, skipping duplicate registration");
    return;
  }
  if (!validate(config.staleReminder.cron)) {
    console.error(
      `Invalid STALE_REMINDER_CRON "${config.staleReminder.cron}"; stale reminders disabled`,
    );
  } else {
    staleJob = schedule(config.staleReminder.cron, () => {
      runStaleCheck().catch((error) => {
        console.error("Stale reminder job failed:", error);
      });
    });
    console.log(`Stale reminder scheduled (cron: ${config.staleReminder.cron})`);
  }

  if (!validate(config.busFactor.cron)) {
    console.error(`Invalid BUS_FACTOR_CRON "${config.busFactor.cron}"; bus-factor reports disabled`);
  } else {
    busFactorJob = schedule(config.busFactor.cron, () => {
      runBusFactorReport().catch((error) => {
        console.error("Bus-factor job failed:", error);
      });
    });
    console.log(`Bus-factor report scheduled (cron: ${config.busFactor.cron})`);
  }
}

export function stopScheduler(): void {
  staleJob?.stop();
  busFactorJob?.stop();
  staleJob = null;
  busFactorJob = null;
}

export async function runBusFactorReport(): Promise<number> {
  const { busFactor } = config;
  if (busFactor.repos.length === 0) {
    console.log("Bus-factor report skipped: no tracked repos configured");
    return 0;
  }

  const risksByRepo = new Map<string, Awaited<ReturnType<typeof fetchBusFactorRisks>>>();
  for (const repo of busFactor.repos) {
    try {
      const risks = await fetchBusFactorRisks(repo, {
        token: config.githubToken,
        thresholdPercent: busFactor.thresholdPercent,
        minCommits: busFactor.minCommits,
        recentCommits: busFactor.recentCommits,
        topFiles: busFactor.topFiles,
      });
      risksByRepo.set(repo, risks);
    } catch (error) {
      console.error(`Bus-factor check failed for ${repo}:`, (error as Error).message);
    }
  }

  const byChat = new Map<string | number, { threadId?: number; repos: Map<string, Awaited<ReturnType<typeof fetchBusFactorRisks>>> }>();
  for (const [repo, risks] of risksByRepo) {
    if (risks.length === 0) continue;
    const destination = resolveDestination(repo, "issues", config.telegramChatId, undefined);
    const group = byChat.get(destination.chatId) ?? { threadId: destination.threadId, repos: new Map() };
    group.repos.set(repo, risks);
    byChat.set(destination.chatId, group);
  }

  let sent = 0;
  for (const [chatId, group] of byChat) {
    try {
      await sendMessage(chatId, formatBusFactorDigest(group.repos, busFactor.topFiles), group.threadId);
      sent += 1;
    } catch (error) {
      console.error(`Failed to send bus-factor digest to chat ${chatId}:`, error);
    }
  }
  if (sent === 0) console.log("Bus-factor report: no files exceeded the configured threshold");
  return sent;
}

// Queries all tracked repos and posts one digest-style reminder per
// destination chat (items with no activity past the threshold). Errors are
// logged per repo/message so a failure never crashes the job.
export async function runStaleCheck(now = new Date()): Promise<number> {
  const { staleReminder } = config;
  if (staleReminder.repos.length === 0) {
    console.log("Stale reminder skipped: no tracked repos configured");
    return 0;
  }

  const items = await collectStaleItems(staleReminder.repos, {
    token: config.githubToken,
    now,
    thresholdDays: staleReminder.thresholdDays,
  });

  if (items.length === 0) {
    console.log("Stale reminder: no stale items found");
    return 0;
  }

  const byChat = new Map<string | number, StaleItem[]>();
  for (const item of items) {
    const { chatId } = resolveDestination(item.repoFullName, "issues", config.telegramChatId, undefined);
    const list = byChat.get(chatId) ?? [];
    list.push(item);
    byChat.set(chatId, list);
  }

  let sent = 0;
  for (const [chatId, chatItems] of byChat) {
    const text = formatStaleDigest(chatItems, now, staleReminder.thresholdDays);
    try {
      await sendMessage(chatId, text);
      sent += 1;
    } catch (error) {
      console.error(`Failed to send stale digest to chat ${chatId}:`, error);
    }
  }
  return sent;
}