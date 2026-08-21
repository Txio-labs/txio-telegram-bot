import type { EmitterWebhookEvent } from "@octokit/webhooks";
import { InlineKeyboard } from "grammy";
import { Formatter } from "../types.js";
import { escapeHtml } from "../../utils/html.js";

type PRReviewPayload = EmitterWebhookEvent<"pull_request_review">["payload"];

function link(url: string, label: string): string {
  return `<a href="${escapeHtml(url)}">${escapeHtml(label)}</a>`;
}

export const plainTextFormatter: Formatter<PRReviewPayload> = {
  id: "plain_text",
  format(payload: PRReviewPayload) {
    const { pull_request: pr, repository, review } = payload;
    const reviewer = review.user?.login ?? "unknown";
    return {
      text: `❌ Changes requested on PR #${pr.number} in ${repository.full_name}\n"${pr.title}"\nReviewer: ${reviewer}`,
      parseMode: undefined,
    };
  }
};

export const markdownSummaryFormatter: Formatter<PRReviewPayload> = {
  id: "markdown_summary",
  format(payload: PRReviewPayload) {
    const { pull_request: pr, repository, review } = payload;
    const reviewer = review.user?.login ?? "unknown";
    const text = `❌ Changes requested on PR in ${link(repository.html_url, repository.full_name)}\n${link(pr.html_url, `#${pr.number} ${pr.title}`)}\nReviewer: ${escapeHtml(reviewer)}`;
    return {
      text,
      parseMode: "HTML",
    };
  }
};

export const inlineButtonsFormatter: Formatter<PRReviewPayload> = {
  id: "inline_buttons",
  format(payload: PRReviewPayload) {
    const baseMessage = markdownSummaryFormatter.format(payload);
    const keyboard = new InlineKeyboard().url("View Review", payload.review.html_url);
    return {
      ...baseMessage,
      replyMarkup: keyboard,
    };
  }
};
