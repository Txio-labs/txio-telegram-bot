import { config } from "./config.js";
import { link } from "./github/formatters.js";
import { getState, updateState, type FirstTimer } from "./store.js";
import { sendMessage } from "./telegram/client.js";
import { escapeHtml } from "./utils/html.js";

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

/** Thanks a first-time contributor in the group when their PR merges. */
export async function recordFirstContribution(f: FirstTimer, title: string): Promise<void> {
  if (getState().firstTimers.some((x) => x.repo === f.repo && x.number === f.number)) return;
  await updateState((s) => void s.firstTimers.push(f));
  if (config.firstContributorShoutout) {
    await sendMessage(config.telegramChatId, formatShoutout(f, title));
  }
}
