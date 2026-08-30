import { describe, it, expect, vi } from "vitest";

// Must set required env vars before config module is imported
vi.hoisted(() => {
  process.env.TELEGRAM_BOT_TOKEN = "fake:token";
  process.env.TELEGRAM_CHAT_ID = "-1000000";
  process.env.TELEGRAM_WEBHOOK_SECRET = "fake-webhook-secret";
  process.env.GITHUB_WEBHOOK_SECRET = "fake-github-secret";
  process.env.PUBLIC_URL = "https://example.com";
});

import { resolveRepoName, getConfiguredRepos } from "../config.js";
import type { RepoRoutingConfig } from "../config.js";

const testRouting: RepoRoutingConfig = {
  "txio-labs/txio-backend": { chatId: "-100999", issues: 101 },
  "txio-labs/txio-cli": { chatId: "-100888" },
  "txio-labs/txio-desktop": { chatId: "-100777" },
  "Txio-Labs/txio-telegram-bot": { chatId: "-100666" },
};

describe("resolveRepoName", () => {
  it("resolves short name to full name", () => {
    expect(resolveRepoName("backend", testRouting)).toBe("txio-labs/txio-backend");
  });

  it("resolves by full name", () => {
    expect(resolveRepoName("txio-labs/txio-backend", testRouting)).toBe("txio-labs/txio-backend");
  });

  it("is case-insensitive", () => {
    expect(resolveRepoName("Backend", testRouting)).toBe("txio-labs/txio-backend");
    expect(resolveRepoName("BACKEND", testRouting)).toBe("txio-labs/txio-backend");
    expect(resolveRepoName("TXIO-BACKEND", testRouting)).toBe("txio-labs/txio-backend");
  });

  it("returns undefined for unknown names", () => {
    expect(resolveRepoName("unknown", testRouting)).toBeUndefined();
  });

  it("returns undefined for ambiguous matches", () => {
    const ambiguous: RepoRoutingConfig = {
      "org/repo-a": { chatId: "1" },
      "org-b/repo-a": { chatId: "2" },
    };
    expect(resolveRepoName("repo-a", ambiguous)).toBeUndefined();
  });

  it("resolves partial full name match", () => {
    expect(resolveRepoName("txio-labs/txio-cli", testRouting)).toBe("txio-labs/txio-cli");
  });

  it("handles the bot's own repo name", () => {
    expect(resolveRepoName("txio-telegram-bot", testRouting)).toBe(
      "Txio-Labs/txio-telegram-bot",
    );
  });
});

describe("getConfiguredRepos", () => {
  it("returns all configured repo full names", () => {
    const repos = getConfiguredRepos(testRouting);
    expect(repos).toHaveLength(4);
    expect(repos).toContain("txio-labs/txio-backend");
    expect(repos).toContain("txio-labs/txio-cli");
  });
});
