import { describe, it, expect, vi, beforeEach } from "vitest";
import { prChangesRequestedNotifier } from "./prChangesRequested.js";
import { config } from "../config.js";
import * as client from "../telegram/client.js";
import { InlineKeyboard } from "grammy";

vi.mock("../config.js", () => ({
  config: {
    prChangesRequested: { channel: "main_chat", format: "markdown_summary" }
  }
}));

vi.mock("../telegram/client.js", () => ({
  sendMessage: vi.fn(),
  notifyChannel: vi.fn(),
}));

describe("prChangesRequested", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockPayload = {
    pull_request: {
      number: 123,
      title: "Fix bug",
      html_url: "https://github.com/owner/repo/pull/123",
    },
    repository: {
      full_name: "owner/repo",
      html_url: "https://github.com/owner/repo",
    },
    review: {
      user: {
        login: "octocat",
      },
      html_url: "https://github.com/owner/repo/pull/123#pullrequestreview-456",
    },
  } as any;

  it("sends via main_chat and markdown_summary", async () => {
    vi.spyOn(config, "prChangesRequested", "get").mockReturnValue({
      channel: "main_chat",
      format: "markdown_summary",
    });

    await prChangesRequestedNotifier.dispatch(mockPayload);

    expect(client.notifyChannel).toHaveBeenCalledWith(
      expect.stringContaining("❌ Changes requested on PR in"),
      undefined,
      { parseMode: "HTML", replyMarkup: undefined }
    );
  });

  it("sends via topic_thread and inline_buttons", async () => {
    vi.spyOn(config, "prChangesRequested", "get").mockReturnValue({
      channel: "topic_thread",
      format: "inline_buttons",
    });

    await prChangesRequestedNotifier.dispatch(mockPayload, { threadId: 999 });

    expect(client.notifyChannel).toHaveBeenCalledWith(
      expect.stringContaining("octocat"),
      999,
      { 
        parseMode: "HTML", 
        replyMarkup: expect.any(InlineKeyboard) 
      }
    );
  });

  it("sends via dm and plain_text", async () => {
    vi.spyOn(config, "prChangesRequested", "get").mockReturnValue({
      channel: "dm",
      format: "plain_text",
    });

    await prChangesRequestedNotifier.dispatch(mockPayload, { dmChatId: "user123" });

    expect(client.sendMessage).toHaveBeenCalledWith(
      "user123",
      expect.stringContaining("❌ Changes requested on PR #123"),
      undefined,
      { parseMode: undefined, replyMarkup: undefined }
    );
  });
});
