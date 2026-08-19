import { describe, it, expect, vi } from "vitest";

// Must set required env vars before config module is imported
vi.hoisted(() => {
  process.env.TELEGRAM_BOT_TOKEN = "fake:token";
  process.env.TELEGRAM_CHAT_ID = "-1000000";
  process.env.TELEGRAM_WEBHOOK_SECRET = "fake-webhook-secret";
  process.env.GITHUB_WEBHOOK_SECRET = "fake-github-secret";
  process.env.PUBLIC_URL = "https://example.com";
});

import { resolveDestination } from "./config.js";
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
});
