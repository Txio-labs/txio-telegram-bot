import { EventNotifier } from "./EventNotifier.js";
import { config } from "../config.js";
import { mainChatAdapter, topicThreadAdapter, dmAdapter } from "./adapters.js";
import { plainTextFormatter, markdownSummaryFormatter, inlineButtonsFormatter } from "./formatters/prChangesRequested.js";
import type { EmitterWebhookEvent } from "@octokit/webhooks";

type PRReviewPayload = EmitterWebhookEvent<"pull_request_review">["payload"];

export const prChangesRequestedNotifier = new EventNotifier<PRReviewPayload>(
  "prChangesRequested",
  () => config.prChangesRequested
)
  .registerAdapter(mainChatAdapter)
  .registerAdapter(topicThreadAdapter)
  .registerAdapter(dmAdapter)
  .registerFormatter(plainTextFormatter)
  .registerFormatter(markdownSummaryFormatter)
  .registerFormatter(inlineButtonsFormatter);
