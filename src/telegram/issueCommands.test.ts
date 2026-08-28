import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.TELEGRAM_BOT_TOKEN = "fake:token";
  process.env.TELEGRAM_CHAT_ID = "-1000000";
  process.env.TELEGRAM_WEBHOOK_SECRET = "fake-webhook-secret";
  process.env.GITHUB_WEBHOOK_SECRET = "fake-github-secret";
  process.env.PUBLIC_URL = "https://example.com";
  process.env.STALE_REPO_NAMES = "Txio-labs/txio-telegram-bot";
});

import { CURATED_ISSUE_LIMIT, formatCuratedIssuesMessage, isTrackedRepo, resolveIssueCommandRepo } from "./issueCommands.js";

describe("issue command helpers", () => {
  it("defaults to the configured tracked repo", () => {
    expect(resolveIssueCommandRepo(undefined, ["Txio-labs/txio-telegram-bot"])).toBe("txio-labs/txio-telegram-bot");
  });

  it("accepts a specified tracked repo regardless of casing", () => {
    expect(isTrackedRepo("Txio-Labs/Txio-Telegram-Bot", ["txio-labs/txio-telegram-bot"])).toBe(true);
  });

  it("rejects an untracked repo when repo mappings exist", () => {
    expect(isTrackedRepo("txio-labs/unknown", ["txio-labs/txio-telegram-bot"])).toBe(false);
  });

  it("formats a label-filtered issue list", () => {
    const text = formatCuratedIssuesMessage({
      repoFullName: "txio-labs/txio-telegram-bot",
      label: "good-first-issue",
      title: "good first issue",
      truncated: false,
      issues: [
        { number: 82, title: "Add curated commands", htmlUrl: "https://github.com/txio-labs/txio-telegram-bot/issues/82" },
      ],
    });

    expect(text).toContain("Open good first issue issues");
    expect(text).toContain('<a href="https://github.com/txio-labs/txio-telegram-bot/issues/82">#82 Add curated commands</a>');
  });

  it("formats an empty-result message", () => {
    const text = formatCuratedIssuesMessage({
      repoFullName: "txio-labs/txio-telegram-bot",
      label: "help-wanted",
      title: "help wanted",
      truncated: false,
      issues: [],
    });

    expect(text).toBe('No open issues currently labeled <code>help-wanted</code> in <a href="https://github.com/txio-labs/txio-telegram-bot">txio-labs/txio-telegram-bot</a>.');
  });

  it("caps output and links to GitHub when truncated", () => {
    const issues = Array.from({ length: CURATED_ISSUE_LIMIT }, (_, index) => ({
      number: index + 1,
      title: `Issue ${index + 1}`,
      htmlUrl: `https://github.com/txio-labs/txio-telegram-bot/issues/${index + 1}`,
    }));
    const text = formatCuratedIssuesMessage({
      repoFullName: "txio-labs/txio-telegram-bot",
      label: "good-first-issue",
      title: "good first issue",
      truncated: true,
      issues,
    });

    expect(text.match(/^• /gm)).toHaveLength(CURATED_ISSUE_LIMIT);
    expect(text).toContain("…and more.");
    expect(text).toContain("/issues?q=is%3Aissue+is%3Aopen+label%3Agood-first-issue");
  });
});
