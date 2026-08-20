import { describe, it, expect, vi } from "vitest";

// Must set required env vars before config module is imported
vi.hoisted(() => {
  process.env.TELEGRAM_BOT_TOKEN = "fake:token";
  process.env.TELEGRAM_CHAT_ID = "-1000000";
  process.env.TELEGRAM_WEBHOOK_SECRET = "fake-webhook-secret";
  process.env.GITHUB_WEBHOOK_SECRET = "fake-github-secret";
  process.env.PUBLIC_URL = "https://example.com";
});

import { resolveDestination, labelMatchesAllowlist } from "./config.js";
import type { RepoRoutingConfig } from "./config.js";

const FALLBACK_CHAT = "-1000000";
const FALLBACK_THREAD = 42;

describe("resolveDestination", () => {
  it("returns fallback when repoFullName is undefined", () => {
    const result = resolveDestination(undefined, "issues", FALLBACK_CHAT, FALLBACK_THREAD);
    expect(result).toEqual({ chatId: FALLBACK_CHAT, threadId: FALLBACK_THREAD });
  });

  it("returns fallback when repo is not in routing config", () => {
    const result = resolveDestination("txio-labs/unknown-repo", "ci", FALLBACK_CHAT, FALLBACK_THREAD);
    expect(result).toEqual({ chatId: FALLBACK_CHAT, threadId: FALLBACK_THREAD });
  });

  it("uses repo chatId and event-specific threadId when fully mapped", () => {
    const routing: RepoRoutingConfig = {
      "txio-labs/txio-backend": {
        chatId: "-100999",
        issues: 101,
        ci: 103,
      },
    };
    const result = resolveDestination("txio-labs/txio-backend", "ci", FALLBACK_CHAT, FALLBACK_THREAD, routing);
    expect(result).toEqual({ chatId: "-100999", threadId: 103 });
  });

  it("falls back to default threadId when event category not set in route", () => {
    const routing: RepoRoutingConfig = {
      "txio-labs/txio-cli": {
        chatId: "-100888",
      },
    };
    const result = resolveDestination("txio-labs/txio-cli", "deploys", FALLBACK_CHAT, FALLBACK_THREAD, routing);
    expect(result).toEqual({ chatId: "-100888", threadId: FALLBACK_THREAD });
  });

  it("falls back to default chatId when route has no chatId", () => {
    const routing: RepoRoutingConfig = {
      "txio-labs/txio-desktop": {
        ci: 201,
      },
    };
    const result = resolveDestination("txio-labs/txio-desktop", "ci", FALLBACK_CHAT, FALLBACK_THREAD, routing);
    expect(result).toEqual({ chatId: FALLBACK_CHAT, threadId: 201 });
  });

  it("normalizes repo name casing for lookup", () => {
    const routing: RepoRoutingConfig = {
      "txio-labs/txio-backend": {
        chatId: "-100777",
        deploys: 50,
      },
    };
    const result = resolveDestination("Txio-Labs/Txio-Backend", "deploys", FALLBACK_CHAT, FALLBACK_THREAD, routing);
    expect(result).toEqual({ chatId: "-100777", threadId: 50 });
  });

  it("returns fallback when repoFullName is null-ish", () => {
    const result = resolveDestination(null as unknown as string, "issues", FALLBACK_CHAT, FALLBACK_THREAD);
    expect(result).toEqual({ chatId: FALLBACK_CHAT, threadId: FALLBACK_THREAD });
  });

  it("handles numeric chatId in config", () => {
    const routing: RepoRoutingConfig = {
      "txio-labs/txio-telegram-bot": {
        chatId: -100666,
        pullRequests: 30,
      },
    };
    const result = resolveDestination("txio-labs/txio-telegram-bot", "pullRequests", FALLBACK_CHAT, FALLBACK_THREAD, routing);
    expect(result).toEqual({ chatId: -100666, threadId: 30 });
  });

  it("routes security alerts via event-specific threadId", () => {
    const routing: RepoRoutingConfig = {
      "txio-labs/txio-backend": {
        chatId: "-100999",
        security: 555,
      },
    };
    const result = resolveDestination("txio-labs/txio-backend", "security", FALLBACK_CHAT, FALLBACK_THREAD, routing);
    expect(result).toEqual({ chatId: "-100999", threadId: 555 });
  });

  it("returns labels from EventCategoryConfig object form", () => {
    const routing: RepoRoutingConfig = {
      "txio-labs/txio-backend": {
        chatId: "-100999",
        issues: { threadId: 101, labels: ["urgent", "critical"] },
      },
    };
    const result = resolveDestination("txio-labs/txio-backend", "issues", FALLBACK_CHAT, FALLBACK_THREAD, routing);
    expect(result).toEqual({ chatId: "-100999", threadId: 101, labels: ["urgent", "critical"] });
  });

  it("returns undefined labels when event category is a plain number", () => {
    const routing: RepoRoutingConfig = {
      "txio-labs/txio-backend": {
        chatId: "-100999",
        issues: 101,
      },
    };
    const result = resolveDestination("txio-labs/txio-backend", "issues", FALLBACK_CHAT, FALLBACK_THREAD, routing);
    expect(result.labels).toBeUndefined();
  });

  it("uses fallback threadId when EventCategoryConfig has no threadId", () => {
    const routing: RepoRoutingConfig = {
      "txio-labs/txio-backend": {
        chatId: "-100999",
        issues: { labels: ["urgent"] },
      },
    };
    const result = resolveDestination("txio-labs/txio-backend", "issues", FALLBACK_CHAT, FALLBACK_THREAD, routing);
    expect(result).toEqual({ chatId: "-100999", threadId: FALLBACK_THREAD, labels: ["urgent"] });
  });
});

describe("labelMatchesAllowlist", () => {
  it("returns true when allowlist is undefined (no filter configured)", () => {
    expect(labelMatchesAllowlist(["bug", "urgent"], undefined)).toBe(true);
  });

  it("returns true when allowlist is undefined and payload is empty", () => {
    expect(labelMatchesAllowlist([], undefined)).toBe(true);
  });

  it("returns true when payload contains a label that matches the allowlist", () => {
    expect(labelMatchesAllowlist(["bug", "urgent"], ["urgent", "critical"])).toBe(true);
  });

  it("returns true when payload contains multiple matching labels", () => {
    expect(labelMatchesAllowlist(["urgent", "critical"], ["urgent", "critical"])).toBe(true);
  });

  it("returns false when no payload label matches the allowlist", () => {
    expect(labelMatchesAllowlist(["bug", "documentation"], ["urgent", "critical"])).toBe(false);
  });

  it("returns false when payload is empty and allowlist is set", () => {
    expect(labelMatchesAllowlist([], ["urgent"])).toBe(false);
  });

  it("is case-sensitive: 'Urgent' does not match 'urgent'", () => {
    expect(labelMatchesAllowlist(["Urgent"], ["urgent"])).toBe(false);
  });

  it("is case-sensitive: exact match passes", () => {
    expect(labelMatchesAllowlist(["urgent"], ["urgent"])).toBe(true);
  });
});
