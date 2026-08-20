import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isMergeConflicted, isDuplicateDelivery, seenDeliveries } from "./webhooks.js";
import { config } from "../config.js";

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock the config module
vi.mock("../config.js", () => ({
  config: {
    telegramBotToken: "fake:token",
    telegramChatId: "-1000000",
    githubToken: undefined,
    githubWebhookSecret: "fake:secret",
    prOpened: {
      channel: "main_chat",
      format: "markdown_summary"
    },
  },
}));

describe("isMergeConflicted", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should not send Authorization header when githubToken is not set", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ mergeable: false }),
    });

    const promise = isMergeConflicted(
      { number: 1, mergeable: null },
      { full_name: "owner/repo" }
    );

    // Fast-forward the 4 second delay
    vi.advanceTimersByTime(4000);
    await promise;

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.github.com/repos/owner/repo/pulls/1",
      expect.objectContaining({
        headers: {
          Accept: "application/vnd.github+json",
        },
      })
    );
  });

  it("should send Authorization header when githubToken is set", async () => {
    // Temporarily set the token
    (config as any).githubToken = "test-token";

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ mergeable: false }),
    });

    const promise = isMergeConflicted(
      { number: 1, mergeable: null },
      { full_name: "owner/repo" }
    );

    // Fast-forward the 4 second delay
    vi.advanceTimersByTime(4000);
    await promise;

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.github.com/repos/owner/repo/pulls/1",
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: "application/vnd.github+json",
          Authorization: "Bearer test-token",
        }),
      })
    );

    // Reset
    (config as any).githubToken = undefined;
  });

  it("should return false when fetch response is not ok (404/401/403)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
    });

    const promise = isMergeConflicted(
      { number: 1, mergeable: null },
      { full_name: "owner/repo" }
    );

    vi.advanceTimersByTime(4000);
    const result = await promise;

    expect(result).toBe(false);
  });

  it("should return true when mergeable is false in API response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ mergeable: false }),
    });

    const promise = isMergeConflicted(
      { number: 1, mergeable: null },
      { full_name: "owner/repo" }
    );

    vi.advanceTimersByTime(4000);
    const result = await promise;

    expect(result).toBe(true);
  });

  it("should return false when mergeable is true in API response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ mergeable: true }),
    });

    const promise = isMergeConflicted(
      { number: 1, mergeable: null },
      { full_name: "owner/repo" }
    );

    vi.advanceTimersByTime(4000);
    const result = await promise;

    expect(result).toBe(false);
  });

  it("should return false when mergeable is null in API response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ mergeable: null }),
    });

    const promise = isMergeConflicted(
      { number: 1, mergeable: null },
      { full_name: "owner/repo" }
    );

    vi.advanceTimersByTime(4000);
    const result = await promise;

    expect(result).toBe(false);
  });

  it("should use pr.mergeable directly when it is already set to false", async () => {
    const result = await isMergeConflicted(
      { number: 1, mergeable: false },
      { full_name: "owner/repo" }
    );

    expect(result).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("should use pr.mergeable directly when it is already set to true", async () => {
    const result = await isMergeConflicted(
      { number: 1, mergeable: true },
      { full_name: "owner/repo" }
    );

    expect(result).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("Webhook deduplication", () => {
  it("detects duplicate deliveries and bounds cache", () => {
    seenDeliveries.clear();
    expect(isDuplicateDelivery("deliv-1")).toBe(false);
    expect(isDuplicateDelivery("deliv-1")).toBe(true);
    expect(isDuplicateDelivery("deliv-2")).toBe(false);
    expect(isDuplicateDelivery("deliv-2")).toBe(true);
  });
});
