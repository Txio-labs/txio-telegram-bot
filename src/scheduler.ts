import { schedule, validate } from "node-cron";
import { config, resolveDestination } from "./config.js";
import { collectStaleItems, formatStaleDigest } from "./stale.js";
import type { StaleItem } from "./stale.js";
import { sendMessage } from "./telegram/client.js";

// Single job instance so hot reloads (tsx watch, redeploys) never register a
// second timer — the schedule itself is stateless.
let job: ReturnType<typeof schedule> | null = null;

export function startScheduler(): void {
  if (job) {
    console.log("Stale reminder scheduler already started, skipping duplicate registration");
    return;
  }
  if (!validate(config.staleReminder.cron)) {
    console.error(
      `Invalid STALE_REMINDER_CRON "${config.staleReminder.cron}"; stale reminders disabled`,
    );
    return;
  }
  job = schedule(config.staleReminder.cron, () => {
    runStaleCheck().catch((error) => {
      console.error("Stale reminder job failed:", error);
    });
  });
  console.log(`Stale reminder scheduled (cron: ${config.staleReminder.cron})`);
}

export function stopScheduler(): void {
  if (job) {
    job.stop();
    job = null;
  }
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