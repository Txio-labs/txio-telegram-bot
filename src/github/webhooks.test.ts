import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  isDuplicateDelivery,
  isMergeConflicted,
  seenDeliveries,
  webhooks,
  clearConflictState,
  hasConflictState,
} from "./webhooks.js";
import {
  formatDependencyUpdateEvent,
  formatPullRequestOpenedEvent,
} from "./formatters.js";
import { config } from "../config.js";

// Must set required env vars before any module under test is imported
vi.hoisted(() => {
  process.env.TELEGRAM_BOT_TOKEN = "fake:token";
  process.env.TELEGRAM_CHAT_ID = "-1000000";
  process.env.TELEGRAM_WEBHOOK_SECRET = "fake-webhook-secret";
  process.env.GITHUB_WEBHOOK_SECRET = "fake-github-secret";
  process.env.PUBLIC_URL = "https://example.com";
});

// Mock sendMessage from telegram client and resolveDestination from config.
// These must be created via vi.hoisted() because vi.mock() factories below
// are hoisted above regular top-level const declarations.
const DEFAULT_DESTINATION = { chatId: "-1000000", threadId: undefined as number | undefined, labels: undefined as string[] | undefined };
const { mockSendMessage, mockResolveDestination } = vi.hoisted(() => ({
  mockSendMessage: vi.fn().mockResolvedValue(undefined),
  mockResolveDestination: vi.fn().mockReturnValue({
    chatId: "-1000000",
    threadId: undefined,
  }),
}));

// Mock the config module. Formatters are NOT mocked — several describe blocks
// below assert on real formatter output, and the label-gate tests only assert
// on whether sendMessage was called, so real formatters work for both.
// labelMatchesAllowlist is kept as the real implementation (via importOriginal)
// because webhooks.ts imports and calls it directly for the label-gate feature;
// only `config` and `resolveDestination` are replaced with test doubles.
vi.mock("../config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config.js")>();
  return {
    ...actual,
    config: {
      telegramBotToken: "fake:token",
      telegramChatId: "-1000000",
      githubToken: undefined,
      githubWebhookSecret: "fake:secret",
      topicThreads: {
        issues: undefined,
        pullRequests: undefined,
        ci: undefined,
        deploys: undefined,
        branches: undefined,
        security: undefined,
      },
      prOpened: { channel: "main_chat", format: "markdown_summary" },
      prClosed: { channel: "main_chat", format: "markdown_summary" },
      securityAlert: { channel: "main_chat", format: "markdown_summary" },
      securityAlertChatId: undefined,
      pullRequestChatId: undefined,
    },
    resolveDestination: mockResolveDestination,
  };
});

vi.mock("../telegram/client.js", () => ({
  sendMessage: mockSendMessage,
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

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
      { full_name: "owner/repo" },
    );
    vi.advanceTimersByTime(4000);
    await promise;

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.github.com/repos/owner/repo/pulls/1",
      expect.objectContaining({
        headers: { Accept: "application/vnd.github+json" },
      }),
    );
  });

  it("should send Authorization header when githubToken is set", async () => {
    (config as any).githubToken = "test-token";

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ mergeable: false }),
    });

    const promise = isMergeConflicted(
      { number: 1, mergeable: null },
      { full_name: "owner/repo" },
    );
    vi.advanceTimersByTime(4000);
    await promise;

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.github.com/repos/owner/repo/pulls/1",
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: "application/vnd.github+json",
          Authorization: "Bearer test-token",
        }),
      }),
    );

    (config as any).githubToken = undefined;
  });

  it("should return false when fetch response is not ok (404/401/403)", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

    const promise = isMergeConflicted(
      { number: 1, mergeable: null },
      { full_name: "owner/repo" },
    );
    vi.advanceTimersByTime(4000);
    expect(await promise).toBe(false);
  });

  it("should return true when mergeable is false in API response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ mergeable: false }),
    });

    const promise = isMergeConflicted(
      { number: 1, mergeable: null },
      { full_name: "owner/repo" },
    );
    vi.advanceTimersByTime(4000);
    expect(await promise).toBe(true);
  });

  it("should return false when mergeable is true in API response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ mergeable: true }),
    });

    const promise = isMergeConflicted(
      { number: 1, mergeable: null },
      { full_name: "owner/repo" },
    );
    vi.advanceTimersByTime(4000);
    expect(await promise).toBe(false);
  });

  it("should return false when mergeable is null in API response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ mergeable: null }),
    });

    const promise = isMergeConflicted(
      { number: 1, mergeable: null },
      { full_name: "owner/repo" },
    );
    vi.advanceTimersByTime(4000);
    expect(await promise).toBe(false);
  });

  it("should use pr.mergeable directly when it is already set to false", async () => {
    const result = await isMergeConflicted(
      { number: 1, mergeable: false },
      { full_name: "owner/repo" },
    );
    expect(result).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("should use pr.mergeable directly when it is already set to true", async () => {
    const result = await isMergeConflicted(
      { number: 1, mergeable: true },
      { full_name: "owner/repo" },
    );
    expect(result).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ── Label-filter gate — helpers ───────────────────────────────────────
// NOTE: repository.html_url is required because these tests exercise the
// real formatIssueEvent/formatPullRequestOpenedEvent (formatters are not
// mocked in this file) — omitting it would throw inside escapeHtml().

function makeIssuePayload(labels: string[] = [], action = "opened") {
  return {
    action,
    issue: {
      number: 1,
      title: "Test issue",
      html_url: "https://github.com/owner/repo/issues/1",
      labels: labels.map((name) => ({ name })),
    },
    repository: { full_name: "owner/repo", html_url: "https://github.com/owner/repo" },
  };
}

function makePRPayload(labels: string[] = [], action = "opened") {
  return {
    action,
    pull_request: {
      number: 1,
      title: "Test PR",
      html_url: "https://github.com/owner/repo/pull/1",
      labels: labels.map((name) => ({ name })),
      mergeable: true,
    },
    repository: { full_name: "owner/repo", html_url: "https://github.com/owner/repo" },
  };
}

// ── Label-filter gate — issues events ────────────────────────────────

describe("label-filter gate — issues events", () => {
  beforeEach(() => {
    mockSendMessage.mockClear();
    mockResolveDestination.mockClear();
    mockResolveDestination.mockReturnValue({ ...DEFAULT_DESTINATION });
    seenDeliveries.clear();
  });

  it("forwards issue event when no allowlist is configured", async () => {
    mockResolveDestination.mockReturnValue({ chatId: "-1000000", threadId: undefined });
    await webhooks.receive({ id: "iss-1", name: "issues", payload: makeIssuePayload(["bug"]) as any });
    expect(mockSendMessage).toHaveBeenCalledOnce();
  });

  it("forwards issue event when payload label matches allowlist", async () => {
    mockResolveDestination.mockReturnValue({ chatId: "-1000000", threadId: undefined, labels: ["urgent", "bug"] });
    await webhooks.receive({ id: "iss-2", name: "issues", payload: makeIssuePayload(["bug"]) as any });
    expect(mockSendMessage).toHaveBeenCalledOnce();
  });

  it("suppresses issue event when payload label does not match allowlist", async () => {
    mockResolveDestination.mockReturnValue({ chatId: "-1000000", threadId: undefined, labels: ["urgent"] });
    await webhooks.receive({ id: "iss-3", name: "issues", payload: makeIssuePayload(["bug"]) as any });
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it("suppresses issue event when payload has zero labels and allowlist is set", async () => {
    mockResolveDestination.mockReturnValue({ chatId: "-1000000", threadId: undefined, labels: ["urgent"] });
    await webhooks.receive({ id: "iss-4", name: "issues", payload: makeIssuePayload([]) as any });
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it("is case-sensitive: 'Urgent' does not match 'urgent' allowlist", async () => {
    mockResolveDestination.mockReturnValue({ chatId: "-1000000", threadId: undefined, labels: ["urgent"] });
    await webhooks.receive({ id: "iss-5", name: "issues", payload: makeIssuePayload(["Urgent"]) as any });
    expect(mockSendMessage).not.toHaveBeenCalled();
  });
});

// ── Label-filter gate — pull_request events ───────────────────────────

describe("label-filter gate — pull_request events", () => {
  beforeEach(() => {
    mockSendMessage.mockClear();
    mockResolveDestination.mockClear();
    mockResolveDestination.mockReturnValue({ ...DEFAULT_DESTINATION });
    seenDeliveries.clear();
  });

  it("forwards PR opened event when no allowlist is configured", async () => {
    mockResolveDestination.mockReturnValue({ chatId: "-1000000", threadId: undefined });
    await webhooks.receive({ id: "pr-1", name: "pull_request", payload: makePRPayload(["feature"]) as any });
    expect(mockSendMessage).toHaveBeenCalled();
  });

  it("forwards PR opened event when payload label matches allowlist", async () => {
    mockResolveDestination.mockReturnValue({ chatId: "-1000000", threadId: undefined, labels: ["urgent", "feature"] });
    await webhooks.receive({ id: "pr-2", name: "pull_request", payload: makePRPayload(["feature"]) as any });
    expect(mockSendMessage).toHaveBeenCalled();
  });

  it("suppresses PR opened event when payload label does not match allowlist", async () => {
    mockResolveDestination.mockReturnValue({ chatId: "-1000000", threadId: undefined, labels: ["urgent"] });
    await webhooks.receive({ id: "pr-3", name: "pull_request", payload: makePRPayload(["bug"]) as any });
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it("suppresses PR opened event when payload has zero labels and allowlist is set", async () => {
    mockResolveDestination.mockReturnValue({ chatId: "-1000000", threadId: undefined, labels: ["urgent"] });
    await webhooks.receive({ id: "pr-4", name: "pull_request", payload: makePRPayload([]) as any });
    expect(mockSendMessage).not.toHaveBeenCalled();
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
    mockResolveDestination.mockReturnValue({ ...DEFAULT_DESTINATION });
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
      } as any,
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
      } as any,
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
      } as any,
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

describe("merge-conflict notification dedup", () => {
  beforeEach(() => {
    clearConflictState("owner/repo", 42);
    clearConflictState("owner/repo", 43);
    mockSendMessage.mockClear();
    mockResolveDestination.mockClear();
    mockResolveDestination.mockReturnValue({ ...DEFAULT_DESTINATION });
    seenDeliveries.clear();
  });

  it("sends alert on first conflict, suppresses repeat on same PR", async () => {
    // First conflict → alert sent.
    await webhooks.receive({
      id: "mc-1",
      name: "pull_request",
      payload: {
        action: "synchronize",
        repository: { full_name: "owner/repo", html_url: "https://github.com/owner/repo" },
        pull_request: { number: 42, title: "WIP", html_url: "https://github.com/owner/repo/pull/42", mergeable: false, labels: [] },
      } as any,
    });
    expect(mockSendMessage).toHaveBeenCalledOnce();
    expect(hasConflictState("owner/repo", 42)).toBe(true);

    // Second synchronize, same PR, still conflicted → suppressed.
    await webhooks.receive({
      id: "mc-2",
      name: "pull_request",
      payload: {
        action: "synchronize",
        repository: { full_name: "owner/repo", html_url: "https://github.com/owner/repo" },
        pull_request: { number: 42, title: "WIP", html_url: "https://github.com/owner/repo/pull/42", mergeable: false, labels: [] },
      } as any,
    });
    expect(mockSendMessage).toHaveBeenCalledOnce(); // still 1, not 2
  });

  it("re-alerts after conflict resolved then reintroduced", async () => {
    // First conflict.
    await webhooks.receive({
      id: "mc-3",
      name: "pull_request",
      payload: {
        action: "synchronize",
        repository: { full_name: "owner/repo", html_url: "https://github.com/owner/repo" },
        pull_request: { number: 42, title: "WIP", html_url: "https://github.com/owner/repo/pull/42", mergeable: false, labels: [] },
      } as any,
    });
    expect(mockSendMessage).toHaveBeenCalledOnce();

    // Conflict resolved → state cleared.
    await webhooks.receive({
      id: "mc-4",
      name: "pull_request",
      payload: {
        action: "synchronize",
        repository: { full_name: "owner/repo", html_url: "https://github.com/owner/repo" },
        pull_request: { number: 42, title: "WIP", html_url: "https://github.com/owner/repo/pull/42", mergeable: true, labels: [] },
      } as any,
    });
    expect(hasConflictState("owner/repo", 42)).toBe(false);

    // New conflict → alert sent again.
    await webhooks.receive({
      id: "mc-5",
      name: "pull_request",
      payload: {
        action: "synchronize",
        repository: { full_name: "owner/repo", html_url: "https://github.com/owner/repo" },
        pull_request: { number: 42, title: "WIP", html_url: "https://github.com/owner/repo/pull/42", mergeable: false, labels: [] },
      } as any,
    });
    expect(mockSendMessage).toHaveBeenCalledTimes(2);
  });

  it("tracks different PRs independently", async () => {
    await webhooks.receive({
      id: "mc-6",
      name: "pull_request",
      payload: {
        action: "synchronize",
        repository: { full_name: "owner/repo", html_url: "https://github.com/owner/repo" },
        pull_request: { number: 42, title: "WIP", html_url: "https://github.com/owner/repo/pull/42", mergeable: false, labels: [] },
      } as any,
    });
    await webhooks.receive({
      id: "mc-7",
      name: "pull_request",
      payload: {
        action: "synchronize",
        repository: { full_name: "owner/repo", html_url: "https://github.com/owner/repo" },
        pull_request: { number: 43, title: "Other", html_url: "https://github.com/owner/repo/pull/43", mergeable: false, labels: [] },
      } as any,
    });
    expect(mockSendMessage).toHaveBeenCalledTimes(2);
    expect(hasConflictState("owner/repo", 42)).toBe(true);
    expect(hasConflictState("owner/repo", 43)).toBe(true);
  });

  it("clears state when PR is closed", async () => {
    await webhooks.receive({
      id: "mc-8",
      name: "pull_request",
      payload: {
        action: "synchronize",
        repository: { full_name: "owner/repo", html_url: "https://github.com/owner/repo" },
        pull_request: { number: 42, title: "WIP", html_url: "https://github.com/owner/repo/pull/42", mergeable: false, labels: [] },
      } as any,
    });
    expect(hasConflictState("owner/repo", 42)).toBe(true);

    await webhooks.receive({
      id: "mc-9",
      name: "pull_request",
      payload: {
        action: "closed",
        repository: { full_name: "owner/repo", html_url: "https://github.com/owner/repo" },
        pull_request: { number: 42, title: "WIP", html_url: "https://github.com/owner/repo/pull/42", labels: [] },
      } as any,
    });
    expect(hasConflictState("owner/repo", 42)).toBe(false);
  });
});
