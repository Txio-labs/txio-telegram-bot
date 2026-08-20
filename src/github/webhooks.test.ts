import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  isDuplicateDelivery,
  isMergeConflicted,
  seenDeliveries,
  webhooks,
} from "./webhooks.js";
import {
  formatDependencyUpdateEvent,
  formatPullRequestOpenedEvent,
} from "./formatters.js";
import { config } from "../config.js";

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock sendMessage from telegram client and resolveDestination from config.
// These must be created via vi.hoisted() because vi.mock() factories below
// are hoisted above regular top-level const declarations.
const { mockSendMessage, mockResolveDestination } = vi.hoisted(() => ({
  mockSendMessage: vi.fn().mockResolvedValue(undefined),
  mockResolveDestination: vi.fn().mockReturnValue({
    chatId: "-1000000",
    threadId: undefined,
  }),
}));

vi.mock("../config.js", () => ({
  config: {
    telegramBotToken: "fake:token",
    telegramChatId: "-1000000",
    githubToken: undefined,
    githubWebhookSecret: "fake:secret",
    prOpened: {
      channel: "main_chat",
      format: "markdown_summary",
    },
    prClosed: {
      channel: "main_chat",
      format: "markdown_summary",
    },
    pullRequestChatId: undefined,
    topicThreads: {
      issues: undefined,
      pullRequests: undefined,
      ci: undefined,
      deploys: undefined,
    },
  },
  resolveDestination: mockResolveDestination,
}));

vi.mock("../telegram/client.js", () => ({
  sendMessage: mockSendMessage,
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

describe("formatDependencyUpdateEvent", () => {
  const baseEvent = {
    id: "test-event",
    payload: {
      action: "opened" as const,
      repository: {
        full_name: "txio-labs/txio",
        html_url: "https://github.com/txio-labs/txio",
      },
      pull_request: {
        number: 42,
        title: "Bump actions/checkout from v3 to v4",
        html_url: "https://github.com/txio-labs/txio/pull/42",
        user: { login: "dependabot[bot]" },
      },
    },
  };

  it("should return plain text without parse mode", () => {
    const result = formatDependencyUpdateEvent(baseEvent as any, "plain_text");
    expect(result.text).toBe(
      "📦 Dependency update in txio-labs/txio\n#42 Bump actions/checkout from v3 to v4\nby dependabot[bot]"
    );
    expect(result.parseMode).toBeUndefined();
    expect(result.replyMarkup).toBeUndefined();
  });

  it("should return HTML with links for markdown_summary format", () => {
    const result = formatDependencyUpdateEvent(baseEvent as any, "markdown_summary");
    expect(result.text).toBe(
      '📦 Dependency update in <a href="https://github.com/txio-labs/txio">txio-labs/txio</a>\n' +
        '<a href="https://github.com/txio-labs/txio/pull/42">#42 Bump actions/checkout from v3 to v4</a>\n' +
        "by dependabot[bot]"
    );
    expect(result.parseMode).toBe("HTML");
    expect(result.replyMarkup).toBeUndefined();
  });

  it("should return HTML with links for default format", () => {
    const result = formatDependencyUpdateEvent(baseEvent as any, "default");
    expect(result.text).toBe(
      '📦 Dependency update in <a href="https://github.com/txio-labs/txio">txio-labs/txio</a>\n' +
        '<a href="https://github.com/txio-labs/txio/pull/42">#42 Bump actions/checkout from v3 to v4</a>\n' +
        "by dependabot[bot]"
    );
    expect(result.parseMode).toBe("HTML");
  });

  it("should escape the user login in HTML format", () => {
    const event = {
      ...baseEvent,
      payload: {
        ...baseEvent.payload,
        pull_request: {
          ...baseEvent.payload.pull_request,
          user: { login: "<script>alert('xss')</script>" },
        },
      },
    };
    const result = formatDependencyUpdateEvent(event as any, "markdown_summary");
    expect(result.text).toContain("&lt;script&gt;alert(&#x27;xss&#x27;)&lt;/script&gt;");
  });
});

describe("formatPullRequestOpenedEvent", () => {
  const baseEvent = {
    id: "test-event",
    payload: {
      action: "opened" as const,
      repository: {
        full_name: "txio-labs/txio",
        html_url: "https://github.com/txio-labs/txio",
      },
      pull_request: {
        number: 42,
        title: "Add new feature",
        html_url: "https://github.com/txio-labs/txio/pull/42",
        user: { login: "human-dev" },
      },
    },
  };

  it("should return standard format for regular PRs", () => {
    const result = formatPullRequestOpenedEvent(baseEvent as any, "markdown_summary");
    expect(result.text).toBe(
      '🆕 Pull request opened in <a href="https://github.com/txio-labs/txio">txio-labs/txio</a>\n' +
        '<a href="https://github.com/txio-labs/txio/pull/42">#42 Add new feature</a>\n' +
        "by human-dev"
    );
    expect(result.parseMode).toBe("HTML");
  });
});

describe("pull_request.opened webhook branching", () => {
  beforeEach(() => {
    seenDeliveries.clear();
    mockSendMessage.mockClear();
    mockResolveDestination.mockClear();
  });

  it("should use dependency formatter when PR has dependencies label", async () => {
    await webhooks.receive({
      id: "test-deps-1",
      name: "pull_request",
      payload: {
        action: "opened",
        repository: {
          full_name: "txio-labs/txio",
          html_url: "https://github.com/txio-labs/txio",
        },
        pull_request: {
          number: 123,
          title: "Bump dependencies",
          html_url: "https://github.com/txio-labs/txio/pull/123",
          user: { login: "dependabot[bot]" },
          labels: [{ name: "dependencies" }],
        },
      },
    });

    expect(mockSendMessage).toHaveBeenCalledWith(
      "-1000000",
      expect.stringContaining("📦 Dependency update"),
      undefined,
      expect.objectContaining({ parseMode: "HTML" })
    );
  });

  it("should use standard formatter when PR has no dependencies label", async () => {
    await webhooks.receive({
      id: "test-normal-1",
      name: "pull_request",
      payload: {
        action: "opened",
        repository: {
          full_name: "txio-labs/txio",
          html_url: "https://github.com/txio-labs/txio",
        },
        pull_request: {
          number: 124,
          title: "Add new feature",
          html_url: "https://github.com/txio-labs/txio/pull/124",
          user: { login: "human-dev" },
          labels: [],
        },
      },
    });

    expect(mockSendMessage).toHaveBeenCalledWith(
      "-1000000",
      expect.stringContaining("🆕 Pull request opened"),
      undefined,
      expect.objectContaining({ parseMode: "HTML" })
    );
  });

  it("should treat PRs with dependencies label alongside other labels as dependency updates", async () => {
    await webhooks.receive({
      id: "test-deps-multi-1",
      name: "pull_request",
      payload: {
        action: "opened",
        repository: {
          full_name: "txio-labs/txio",
          html_url: "https://github.com/txio-labs/txio",
        },
        pull_request: {
          number: 125,
          title: "Bump rust dependencies",
          html_url: "https://github.com/txio-labs/txio/pull/125",
          user: { login: "dependabot[bot]" },
          labels: [
            { name: "dependencies" },
            { name: "rust" },
            { name: "ci" },
          ],
        },
      },
    });

    expect(mockSendMessage).toHaveBeenCalledWith(
      "-1000000",
      expect.stringContaining("📦 Dependency update"),
      undefined,
      expect.objectContaining({ parseMode: "HTML" })
    );
  });
});

describe("isDuplicateDelivery", () => {
  beforeEach(() => {
    seenDeliveries.clear();
  });

  it("detects duplicate deliveries", () => {
    expect(isDuplicateDelivery("deliv-1")).toBe(false);
    expect(isDuplicateDelivery("deliv-1")).toBe(true);
    expect(isDuplicateDelivery("deliv-2")).toBe(false);
    expect(isDuplicateDelivery("deliv-2")).toBe(true);
  });
});
