import { describe, it, expect, vi } from "vitest";

// Commands pull in config, which validates required env at import time —
// set them before any module loads (same pattern as config.test.ts).
vi.hoisted(() => {
  process.env.TELEGRAM_BOT_TOKEN = "fake:token";
  process.env.TELEGRAM_CHAT_ID = "-1000000";
  process.env.TELEGRAM_WEBHOOK_SECRET = "fake-webhook-secret";
  process.env.GITHUB_WEBHOOK_SECRET = "fake-github-secret";
  process.env.PUBLIC_URL = "https://example.com";
});
import {
  buildHelpText,
  commandRegistry,
  formatStats,
  resolveRepo,
} from "./commands.js";
import { config } from "../config.js";

describe("help / command registry (#40)", () => {
  it("lists every registered command in the help output", () => {
    const text = buildHelpText();
    for (const cmd of commandRegistry) {
      expect(text).toContain(`/${cmd.name}`);
      expect(text).toContain(cmd.description);
    }
  });

  it("groups commands under category headers", () => {
    const text = buildHelpText();
    expect(text).toContain("Repo info");
    expect(text).toContain("Contributing");
    expect(text).toContain("Bot");
  });

  it("stays under Telegram's 4096-character message limit", () => {
    expect(buildHelpText().length).toBeLessThan(4096);
  });

  it("registry names are unique", () => {
    const names = commandRegistry.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("resolveRepo", () => {
  it("defaults to the first tracked repo when no argument is given", () => {
    const expected = config.repos[0] ?? null;
    expect(resolveRepo(undefined)).toBe(expected);
  });

  it("normalizes a bare name to the txio-labs org", () => {
    expect(resolveRepo("txio-cli")).toBe("txio-labs/txio-cli");
  });

  it("lowercases and strips a leading @ from full names", () => {
    expect(resolveRepo("@Txio-Labs/Txio-CLI")).toBe("txio-labs/txio-cli");
  });

  it("returns null when nothing is tracked", () => {
    if (config.repos.length > 0) return; // only meaningful with empty routing
    expect(resolveRepo(undefined)).toBeNull();
  });
});

describe("formatStats (#44)", () => {
  it("renders the three headline numbers", () => {
    const text = formatStats("txio-labs/txio-cli", {
      openIssues: 12,
      openPullRequests: 3,
      contributors: "40+",
    });
    expect(text).toContain("txio-labs/txio-cli");
    expect(text).toContain("Issues open: <b>12</b>");
    expect(text).toContain("PRs open: <b>3</b>");
    expect(text).toContain("Contributors: <b>40+</b>");
  });
});
