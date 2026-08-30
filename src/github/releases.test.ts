import { describe, it, expect, vi, beforeEach } from "vitest";
import type { EmitterWebhookEvent } from "@octokit/webhooks";

vi.hoisted(() => {
  process.env.TELEGRAM_BOT_TOKEN = "fake:token";
  process.env.TELEGRAM_CHAT_ID = "-1000000";
  process.env.TELEGRAM_WEBHOOK_SECRET = "fake-webhook-secret";
  process.env.GITHUB_WEBHOOK_SECRET = "fake-github-secret";
  process.env.PUBLIC_URL = "https://example.com";
  process.env.TOPIC_THREAD_RELEASES = "103";
});

vi.mock("../telegram/client.js", () => ({
  sendMessage: vi.fn(),
}));

import { webhooks } from "./webhooks.js";
import { sendMessage } from "../telegram/client.js";
import { formatReleaseEvent, COMMENT_PREVIEW_LENGTH } from "./formatters.js";

const mockSendMessage = vi.mocked(sendMessage);

let deliveryId = 0;
function receive(name: string, payload: Record<string, unknown>): Promise<void> {
  deliveryId += 1;
  return webhooks.receive({ id: `delivery-${deliveryId}`, name, payload } as EmitterWebhookEvent);
}

function repository(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    full_name: "txio-labs/txio-cli",
    html_url: "https://github.com/txio-labs/txio-cli",
    default_branch: "main",
    ...overrides,
  };
}

function releasePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    action: "published",
    release: {
      tag_name: "v1.2.0",
      name: "v1.2.0",
      body: "Bug fixes and improvements",
      html_url: "https://github.com/txio-labs/txio-cli/releases/tag/v1.2.0",
      draft: false,
      prerelease: false,
      ...overrides,
    },
    repository: repository(),
    sender: { login: "alice" },
  };
}

describe("formatReleaseEvent", () => {
  it("formats a standard release with tag, name, and body", () => {
    const text = formatReleaseEvent({
      id: "1",
      name: "release",
      payload: releasePayload() as never,
    } as unknown as EmitterWebhookEvent<"release">);

    expect(text).toContain("📦");
    expect(text).toContain("Release published");
    expect(text).toContain("<a href=");
    expect(text).toContain("txio-labs/txio-cli");
    expect(text).toContain("v1.2.0");
    expect(text).toContain("Bug fixes and improvements");
  });

  it("formats a pre-release with a different icon", () => {
    const text = formatReleaseEvent({
      id: "1",
      name: "release",
      payload: releasePayload({ prerelease: true }) as never,
    } as unknown as EmitterWebhookEvent<"release">);

    expect(text).toContain("🏷️");
    expect(text).toContain("Release published");
    expect(text).not.toContain("📦");
  });

  it("returns null for draft releases", () => {
    const text = formatReleaseEvent({
      id: "1",
      name: "release",
      payload: releasePayload({ draft: true }) as never,
    } as unknown as EmitterWebhookEvent<"release">);

    expect(text).toBeNull();
  });

  it("handles missing release name", () => {
    const text = formatReleaseEvent({
      id: "1",
      name: "release",
      payload: releasePayload({ name: "" }) as never,
    } as unknown as EmitterWebhookEvent<"release">);

    expect(text).toContain("v1.2.0");
    expect(text).not.toContain("v1.2.0 —");
  });

  it("handles empty body", () => {
    const text = formatReleaseEvent({
      id: "1",
      name: "release",
      payload: releasePayload({ body: "" }) as never,
    } as unknown as EmitterWebhookEvent<"release">);

    expect(text).toContain("📦");
    expect(text).toContain("v1.2.0");
    const lines = text!.split("\n");
    expect(lines).toHaveLength(2);
  });

  it("handles null body", () => {
    const text = formatReleaseEvent({
      id: "1",
      name: "release",
      payload: releasePayload({ body: null }) as never,
    } as unknown as EmitterWebhookEvent<"release">);

    expect(text).toContain("📦");
    const lines = text!.split("\n");
    expect(lines).toHaveLength(2);
  });

  it("truncates long release body", () => {
    const longBody = "x".repeat(COMMENT_PREVIEW_LENGTH + 50);
    const text = formatReleaseEvent({
      id: "1",
      name: "release",
      payload: releasePayload({ body: longBody }) as never,
    } as unknown as EmitterWebhookEvent<"release">);

    expect(text).toContain("…");
    expect(text).not.toContain(longBody);
  });

  it("escapes HTML in tag name and body", () => {
    const text = formatReleaseEvent({
      id: "1",
      name: "release",
      payload: releasePayload({
        tag_name: "v1.0.0<script>",
        body: "a <script>alert('x')</script> & more",
      }) as never,
    } as unknown as EmitterWebhookEvent<"release">);

    expect(text).toContain("&lt;script&gt;");
    expect(text).toContain("&amp;");
    expect(text).not.toContain("<script>");
  });
});

describe("release.published handler", () => {
  beforeEach(() => {
    mockSendMessage.mockClear();
  });

  it("posts a notification to the releases topic thread", async () => {
    await receive("release.published", releasePayload());

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    const [chatId, text, threadId] = mockSendMessage.mock.calls[0];
    expect(chatId).toBe("-1000000");
    expect(threadId).toBe(103);
    expect(text).toContain("Release published");
    expect(text).toContain("v1.2.0");
  });

  it("does not post for draft releases", async () => {
    await receive("release.published", releasePayload({ draft: true }));

    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it("ignores duplicate deliveries", async () => {
    const payload = releasePayload();
    await webhooks.receive({ id: "dup-release", name: "release.published", payload } as unknown as EmitterWebhookEvent);
    await webhooks.receive({ id: "dup-release", name: "release.published", payload } as unknown as EmitterWebhookEvent);

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
  });
});
