import { describe, it, expect, vi, beforeEach } from "vitest";
import { GrammyError } from "grammy";

const { mockSendMessage, mockUse } = vi.hoisted(() => ({
  mockSendMessage: vi.fn().mockResolvedValue({ message_id: 1 }),
  mockUse: vi.fn(),
}));

vi.mock("../config.js", () => ({
  config: {
    telegramBotToken: "fake:token",
    telegramChatId: "-1000000",
    topicThreads: {
      issues: 1,
      pullRequests: 2,
      ci: 3,
      deploys: 4,
      branches: 5,
    },
  },
}));

vi.mock("../utils/html.js", () => ({
  escapeHtml: (s: string) => s,
}));

vi.mock("grammy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("grammy")>();
  class MockBot {
    api = { sendMessage: mockSendMessage, config: { use: mockUse } };
    catch = vi.fn();
    on = vi.fn();
    constructor(_token: string) {}
  }
  return { ...actual, Bot: MockBot };
});

const mockAutoRetry = vi.fn((_opts?: unknown) => () => {});
vi.mock("@grammyjs/auto-retry", () => ({
  autoRetry: (opts: unknown) => mockAutoRetry(opts),
}));

describe("telegram client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("auto-retry plugin setup", () => {
    it("applies auto-retry transformer with bounded options", async () => {
      await import("./client.js");

      expect(mockAutoRetry).toHaveBeenCalledWith({
        maxRetryAttempts: 5,
        maxDelaySeconds: 30,
      });
      expect(mockUse).toHaveBeenCalled();
    });
  });

  describe("sendMessage", () => {
    it("sends message with correct parameters", async () => {
      const { sendMessage } = await import("./client.js");

      await sendMessage("-1000000", "hello");

      expect(mockSendMessage).toHaveBeenCalledWith("-1000000", "hello", {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
        message_thread_id: undefined,
        reply_markup: undefined,
      });
    });

    it("passes threadId", async () => {
      const { sendMessage } = await import("./client.js");

      await sendMessage("-1000000", "hello", 42);

      expect(mockSendMessage).toHaveBeenCalledWith("-1000000", "hello", {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
        message_thread_id: 42,
        reply_markup: undefined,
      });
    });

    it("passes replyMarkup", async () => {
      const { sendMessage } = await import("./client.js");
      const markup = { inline_keyboard: [[{ text: "btn", url: "https://example.com" }]] };

      await sendMessage("-1000000", "hello", 42, { replyMarkup: markup });

      expect(mockSendMessage).toHaveBeenCalledWith("-1000000", "hello", {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
        message_thread_id: 42,
        reply_markup: markup,
      });
    });

    it("propagates errors from bot.api.sendMessage", async () => {
      const { sendMessage } = await import("./client.js");
      mockSendMessage.mockRejectedValueOnce(new Error("network error"));

      await expect(sendMessage("-1000000", "hello")).rejects.toThrow("network error");
    });
  });

  describe("notifyChannel", () => {
    it("delegates to sendMessage with configured chatId", async () => {
      const { notifyChannel } = await import("./client.js");

      await notifyChannel("test", 7);

      expect(mockSendMessage).toHaveBeenCalledWith("-1000000", "test", {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
        message_thread_id: 7,
        reply_markup: undefined,
      });
    });
  });
});

describe("auto-retry 429 error structure", () => {
  it("GrammyError with retry_after has correct parameters", () => {
    const error = new GrammyError(
      "Too Many Requests: retry after 1",
      { error_code: 429, description: "Too Many Requests", parameters: { retry_after: 1 } },
      "sendMessage",
      {},
    );

    expect(error.error_code).toBe(429);
    expect(error.parameters?.retry_after).toBe(1);
  });

  it("GrammyError without retry_after has undefined parameters", () => {
    const error = new GrammyError(
      "Too Many Requests",
      { error_code: 429, description: "Too Many Requests" },
      "sendMessage",
      {},
    );

    expect(error.error_code).toBe(429);
    expect(error.parameters?.retry_after).toBeUndefined();
  });
});
