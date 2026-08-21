import { describe, it, expect, vi, beforeEach } from "vitest";
import { webhooks } from "./webhooks.js";
import { config } from "../config.js";
import * as client from "../telegram/client.js";

vi.mock("../config.js", () => ({
  config: {
    prChangesRequested: { channel: "main_chat", format: "markdown_summary" },
    topicThreads: {},
    pullRequestChatId: undefined,
    githubWebhookSecret: "secret"
  }
}));

vi.mock("../telegram/client.js", () => ({
  sendMessage: vi.fn(),
  notifyChannel: vi.fn(),
}));

describe("pull_request_review end-to-end routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const generatePayload = (state: string) => ({
    id: String(Math.random()),
    name: "pull_request_review",
    payload: {
      action: "submitted",
      review: {
        state,
        user: { login: "testuser" },
        html_url: "https://github.com/test/test",
      },
      pull_request: {
        number: 1,
        title: "Test PR",
        html_url: "https://github.com/test/test/pull/1",
      },
      repository: {
        full_name: "test/test",
        html_url: "https://github.com/test/test",
      },
    },
  } as any);

  it("ignores non-changes_requested states", async () => {
    await webhooks.receive(generatePayload("approved"));
    await webhooks.receive(generatePayload("commented"));
    expect(client.notifyChannel).not.toHaveBeenCalled();
    expect(client.sendMessage).not.toHaveBeenCalled();
  });

  it("routes to main_chat and markdown_summary properly", async () => {
    vi.spyOn(config, "prChangesRequested", "get").mockReturnValue({
      channel: "main_chat",
      format: "markdown_summary",
    });

    await webhooks.receive(generatePayload("changes_requested"));

    expect(client.notifyChannel).toHaveBeenCalledWith(
      expect.stringContaining("testuser"),
      undefined,
      expect.objectContaining({ parseMode: "HTML" })
    );
  });

  it("routes to topic_thread and inline_buttons properly", async () => {
    vi.spyOn(config, "prChangesRequested", "get").mockReturnValue({
      channel: "topic_thread",
      format: "inline_buttons",
    });
    
    // Simulate config for topic thread
    (config.topicThreads as any).pullRequests = 1234;

    await webhooks.receive(generatePayload("changes_requested"));

    expect(client.notifyChannel).toHaveBeenCalledWith(
      expect.stringContaining("testuser"),
      1234,
      expect.objectContaining({ parseMode: "HTML", replyMarkup: expect.anything() })
    );
  });

  it("routes to dm and plain_text properly", async () => {
    vi.spyOn(config, "prChangesRequested", "get").mockReturnValue({
      channel: "dm",
      format: "plain_text",
    });
    
    // Simulate config for DM
    (config as any).pullRequestChatId = "dm_123";

    await webhooks.receive(generatePayload("changes_requested"));

    expect(client.sendMessage).toHaveBeenCalledWith(
      "dm_123",
      expect.stringContaining("testuser"),
      undefined,
      expect.objectContaining({ parseMode: undefined })
    );
  });
});
