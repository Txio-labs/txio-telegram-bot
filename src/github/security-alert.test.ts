import { describe, it, expect, vi, beforeEach } from "vitest";
import type { EmitterWebhookEvent } from "@octokit/webhooks";

const state = vi.hoisted(() => ({
  config: {
    telegramChatId: "-1000000",
    githubWebhookSecret: "fake-secret",
    topicThreads: {
      issues: undefined,
      pullRequests: undefined,
      ci: undefined,
      deploys: undefined,
      security: 501,
    },
    securityAlert: { channel: "main_chat", format: "markdown_summary" },
    securityAlertChatId: undefined as string | undefined,
    pullRequestChatId: undefined,
    githubToken: undefined,
    prOpened: { channel: "main_chat", format: "markdown_summary" },
    prClosed: { channel: "main_chat", format: "markdown_summary" },
  },
  sendMessage: vi.fn(),
  lastRouting: undefined as { repo: string | undefined; category: string } | undefined,
}));

vi.mock("../config.js", () => ({
  config: state.config,
  resolveDestination: (
    repoFullName: string | undefined,
    eventCategory: string,
    fallbackChatId: string | number,
    fallbackThreadId: number | undefined,
  ) => {
    state.lastRouting = { repo: repoFullName, category: eventCategory };
    return { chatId: fallbackChatId, threadId: fallbackThreadId };
  },
}));

vi.mock("../telegram/client.js", () => ({
  sendMessage: state.sendMessage,
}));

import { webhooks, seenDeliveries } from "./webhooks.js";
import { formatSecurityAlertEvent } from "./formatters.js";

function makeAlertEvent(
  overrides: Partial<EmitterWebhookEvent<"dependabot_alert">> = {},
): EmitterWebhookEvent<"dependabot_alert"> {
  return {
    id: "delivery-123",
    name: "dependabot_alert",
    payload: {
      action: "created",
      alert: {
        number: 42,
        state: "open",
        dependency: {
          package: { ecosystem: "npm", name: "lodash" },
          manifest_path: "package-lock.json",
          scope: "runtime",
          relationship: "direct",
        },
        security_advisory: {
          ghsa_id: "GHSA-xxxx-xxxx-xxxx",
          cve_id: "CVE-2020-8203",
          summary: "Prototype pollution in lodash",
          description: "A prototype pollution vulnerability in lodash.",
          vulnerabilities: [],
          severity: "high",
          cvss: { score: 7.4, vector_string: "CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:H/I:N/A:N" },
          cwes: [],
          identifiers: [],
          references: [],
          published_at: "2026-08-20T00:00:00Z",
          updated_at: "2026-08-20T00:00:00Z",
          withdrawn_at: null,
        },
        security_vulnerability: {
          package: { ecosystem: "npm", name: "lodash" },
          severity: "high",
          vulnerable_version_range: "< 4.17.21",
          first_patched_version: { identifier: "4.17.21" },
        },
        url: "https://api.github.com/repos/txio-labs/txio-backend/dependabot_alerts/42",
        html_url: "https://github.com/txio-labs/txio-backend/security/dependabot/42",
        created_at: "2026-08-20T00:00:00Z",
        updated_at: "2026-08-20T00:00:00Z",
        dismissed_at: null,
        dismissed_by: null,
        dismissed_reason: null,
        dismissed_comment: null,
        fixed_at: null,
        auto_dismissed_at: null,
      },
      repository: {
        full_name: "txio-labs/txio-backend",
        html_url: "https://github.com/txio-labs/txio-backend",
      },
      sender: { login: "dependabot[bot]" },
    },
    ...overrides,
  } as unknown as EmitterWebhookEvent<"dependabot_alert">;
}

beforeEach(() => {
  vi.clearAllMocks();
  seenDeliveries.clear();
  state.lastRouting = undefined;
  state.config.securityAlert = { channel: "main_chat", format: "markdown_summary" };
  state.config.securityAlertChatId = undefined;
});

describe("formatSecurityAlertEvent", () => {
  it("renders markdown_summary with linked repo, alert, severity and dependency", () => {
    const { text, parseMode, replyMarkup } = formatSecurityAlertEvent(makeAlertEvent(), "markdown_summary");
    expect(parseMode).toBe("HTML");
    expect(replyMarkup).toBeUndefined();
    expect(text).toContain('<a href="https://github.com/txio-labs/txio-backend"');
    expect(text).toContain('<a href="https://github.com/txio-labs/txio-backend/security/dependabot/42"');
    expect(text).toContain("Prototype pollution in lodash");
    expect(text).toContain("Severity: high");
    expect(text).toContain("lodash (npm)");
    expect(text).toContain("&lt; 4.17.21");
    expect(text).toContain("Patched in: 4.17.21");
    expect(text).toContain("GHSA-xxxx-xxxx-xxxx · CVE-2020-8203");
  });

  it("renders plain_text without HTML markup but with the alert URL", () => {
    const { text, parseMode } = formatSecurityAlertEvent(makeAlertEvent(), "plain_text");
    expect(parseMode).toBeUndefined();
    expect(text).not.toContain("<a ");
    expect(text).toContain("txio-labs/txio-backend");
    expect(text).toContain("lodash (npm)");
    expect(text).toContain("Severity: high");
    expect(text).toContain("https://github.com/txio-labs/txio-backend/security/dependabot/42");
  });

  it("renders inline_buttons with a View Alert keyboard", () => {
    const { replyMarkup } = formatSecurityAlertEvent(makeAlertEvent(), "inline_buttons");
    expect(replyMarkup).toBeDefined();
  });

  it("escapes security-related and user-controlled fields in HTML output", () => {
    const event = makeAlertEvent();
    (event.payload as any).alert.security_advisory.summary = '<script>alert("xss")</script>';
    (event.payload as any).alert.security_vulnerability.package.name = '<b>lodash</b>';
    (event.payload as any).alert.security_vulnerability.vulnerable_version_range = "< 4.17.21 & more";

    const { text } = formatSecurityAlertEvent(event, "markdown_summary");

    expect(text).not.toContain("<script>");
    expect(text).not.toContain("<b>lodash</b>");
    expect(text).toContain("&lt;script&gt;");
    expect(text).toContain("&lt;b&gt;lodash&lt;/b&gt;");
    expect(text).toContain("&lt; 4.17.21 &amp; more");
  });

  it("handles missing advisory and vulnerability fields gracefully", () => {
    const event = makeAlertEvent();
    (event.payload as any).alert.security_advisory = null;
    (event.payload as any).alert.security_vulnerability = null;
    (event.payload as any).alert.dependency = {};

    const { text, parseMode } = formatSecurityAlertEvent(event, "markdown_summary");

    expect(parseMode).toBe("HTML");
    expect(text).toContain("#42 vulnerable dependency");
    expect(text).toContain("Severity: unknown");
    expect(text).toContain("Dependency: unknown (unknown)");
  });
});

describe("dependabot_alert.created webhook handler", () => {
  it("sends to the main chat with markdown_summary by default", async () => {
    const event = makeAlertEvent();
    await webhooks.receive({ id: event.id, name: event.name, payload: event.payload });

    expect(state.sendMessage).toHaveBeenCalledTimes(1);
    const [chatId, text, threadId, options] = state.sendMessage.mock.calls[0];
    expect(chatId).toBe("-1000000");
    expect(threadId).toBeUndefined();
    expect(options.parseMode).toBe("HTML");
    expect(text).toContain("lodash");
  });

  it("routes to the security topic thread via the security category", async () => {
    state.config.securityAlert = { channel: "topic_thread", format: "markdown_summary" };
    const event = makeAlertEvent();
    await webhooks.receive({ id: event.id, name: event.name, payload: event.payload });

    expect(state.lastRouting).toEqual({ repo: "txio-labs/txio-backend", category: "security" });
    expect(state.sendMessage).toHaveBeenCalledTimes(1);
    const [chatId, , threadId, options] = state.sendMessage.mock.calls[0];
    expect(chatId).toBe("-1000000");
    expect(threadId).toBe(501);
    expect(options.parseMode).toBe("HTML");
  });

  it("routes to the configured DM chat with plain_text", async () => {
    state.config.securityAlert = { channel: "dm", format: "plain_text" };
    state.config.securityAlertChatId = "12345";
    const event = makeAlertEvent();
    await webhooks.receive({ id: event.id, name: event.name, payload: event.payload });

    expect(state.sendMessage).toHaveBeenCalledTimes(1);
    const [chatId, text, threadId, options] = state.sendMessage.mock.calls[0];
    expect(chatId).toBe("12345");
    expect(threadId).toBeUndefined();
    expect(options.parseMode).toBeUndefined();
    expect(text).not.toContain("<a ");
  });

  it("falls back to the main chat when dm is configured without a DM chat id", async () => {
    state.config.securityAlert = { channel: "dm", format: "plain_text" };
    const event = makeAlertEvent();
    await webhooks.receive({ id: event.id, name: event.name, payload: event.payload });

    expect(state.sendMessage).toHaveBeenCalledTimes(1);
    const [chatId] = state.sendMessage.mock.calls[0];
    expect(chatId).toBe("-1000000");
  });

  it("skips duplicate deliveries", async () => {
    const event = makeAlertEvent();
    await webhooks.receive({ id: event.id, name: event.name, payload: event.payload });
    await webhooks.receive({ id: event.id, name: event.name, payload: event.payload });

    expect(state.sendMessage).toHaveBeenCalledTimes(1);
  });
});