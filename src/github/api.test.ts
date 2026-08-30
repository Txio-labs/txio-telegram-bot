import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.TELEGRAM_BOT_TOKEN = "fake:token";
  process.env.TELEGRAM_CHAT_ID = "-1000000";
  process.env.TELEGRAM_WEBHOOK_SECRET = "fake-webhook-secret";
  process.env.GITHUB_WEBHOOK_SECRET = "fake-github-secret";
  process.env.PUBLIC_URL = "https://example.com";
});

import { listOpenIssuesByLabel } from "./api.js";

describe("listOpenIssuesByLabel", () => {
  it("queries open issues by label and filters pull requests", async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      json: async () => [
        { number: 1, title: "Issue", html_url: "https://github.com/o/r/issues/1" },
        { number: 2, title: "PR", html_url: "https://github.com/o/r/pull/2", pull_request: {} },
      ],
    })) as unknown as typeof fetch;

    const issues = await listOpenIssuesByLabel("o/r", "good-first-issue", { fetchFn, token: "token", perPage: 11 });

    expect(fetchFn).toHaveBeenCalledWith(
      "https://api.github.com/repos/o/r/issues?state=open&labels=good-first-issue&per_page=11",
      { headers: { Accept: "application/vnd.github+json", Authorization: "Bearer token" } },
    );
    expect(issues).toEqual([{ number: 1, title: "Issue", htmlUrl: "https://github.com/o/r/issues/1" }]);
  });

  it("throws when GitHub responds with an error", async () => {
    const fetchFn = vi.fn(async () => ({ ok: false, status: 404, statusText: "Not Found" })) as unknown as typeof fetch;

    await expect(listOpenIssuesByLabel("o/r", "help-wanted", { fetchFn })).rejects.toThrow(
      "GitHub API returned 404 Not Found for o/r",
    );
  });
});
