import { describe, it, expect, vi, beforeEach } from "vitest";

// Must set required env vars before config module is imported
vi.hoisted(() => {
  process.env.TELEGRAM_BOT_TOKEN = "fake:token";
  process.env.TELEGRAM_CHAT_ID = "-1000000";
  process.env.TELEGRAM_WEBHOOK_SECRET = "fake-webhook-secret";
  process.env.GITHUB_WEBHOOK_SECRET = "fake-github-secret";
  process.env.PUBLIC_URL = "https://example.com";
});

const SECURITY_ENV_VARS = [
  "SECURITY_ALERT_CHANNEL",
  "SECURITY_ALERT_FORMAT",
  "SECURITY_ALERT_CHAT_ID",
  "TOPIC_THREAD_SECURITY",
];

beforeEach(() => {
  vi.resetModules();
  for (const name of SECURITY_ENV_VARS) {
    delete process.env[name];
  }
});

async function loadConfig() {
  const mod = await import("./config.js");
  return mod.config;
}

describe("security alert configuration", () => {
  it("defaults channel to main_chat and format to markdown_summary", async () => {
    const config = await loadConfig();
    expect(config.securityAlert).toEqual({
      channel: "main_chat",
      format: "markdown_summary",
    });
  });

  it("leaves security DM chat and topic unset by default", async () => {
    const config = await loadConfig();
    expect(config.securityAlertChatId).toBeUndefined();
    expect(config.topicThreads.security).toBeUndefined();
  });

  it("honors SECURITY_ALERT_CHANNEL and SECURITY_ALERT_FORMAT overrides", async () => {
    process.env.SECURITY_ALERT_CHANNEL = "topic_thread";
    process.env.SECURITY_ALERT_FORMAT = "markdown_summary";
    const config = await loadConfig();
    expect(config.securityAlert).toEqual({
      channel: "topic_thread",
      format: "markdown_summary",
    });
  });

  it("honors SECURITY_ALERT_CHAT_ID and TOPIC_THREAD_SECURITY overrides", async () => {
    process.env.SECURITY_ALERT_CHAT_ID = "12345";
    process.env.TOPIC_THREAD_SECURITY = "888";
    const config = await loadConfig();
    expect(config.securityAlertChatId).toBe("12345");
    expect(config.topicThreads.security).toBe(888);
  });

  it("supports all documented channel/format combinations", async () => {
    const channels = ["main_chat", "topic_thread", "dm"];
    const formats = ["markdown_summary", "plain_text", "inline_buttons"];
    for (const channel of channels) {
      for (const format of formats) {
        vi.resetModules();
        process.env.SECURITY_ALERT_CHANNEL = channel;
        process.env.SECURITY_ALERT_FORMAT = format;
        const config = await loadConfig();
        expect(config.securityAlert).toEqual({ channel, format });
      }
    }
  });
});