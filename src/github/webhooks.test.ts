import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Must set required env vars before any module under test is imported
vi.hoisted(() => {
  process.env.TELEGRAM_BOT_TOKEN = "fake:token";
  process.env.TELEGRAM_CHAT_ID = "-1000000";
  process.env.TELEGRAM_WEBHOOK_SECRET = "fake-webhook-secret";
  process.env.GITHUB_WEBHOOK_SECRET = "fake-github-secret";
  process.env.PUBLIC_URL = "https://example.com";
});

// Mock sendMessage so we can spy on it across all tests
vi.mock("../telegram/client.js", () => ({
  sendMessage: vi.fn().mockResolvedValue(undefined),
}));

// Stub formatters — return minimal shapes so webhook handlers don't throw
vi.mock("./formatters.js", () => ({
  formatIssueEvent: vi.fn(() => "issue text"),
  formatPullRequestOpenedEvent: vi.fn(() => ({ text: "pr opened text", parseMode: undefined, replyMarkup: undefined })),
  formatPullRequestClosedEvent: vi.fn(() => ({ text: "pr closed text", parseMode: undefined, replyMarkup: undefined })),
  formatMergeConflictEvent: vi.fn(() => "merge conflict text"),
  formatWorkflowRunEvent: vi.fn(() => "workflow text"),
  formatDeploymentStatusEvent: vi.fn(() => "deploy text"),
}));

// Mock the config module. Keep actual pure helpers (labelMatchesAllowlist,
// resolveDestination) so label-gate tests get real logic; make resolveDestination
// a spy so tests can control what it returns.
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
      },
      prOpened: { channel: "main_chat", format: "markdown_summary" },
      prClosed: { channel: "main_chat", format: "markdown_summary" },
      pullRequestChatId: undefined,
    },
    resolveDestination: vi.fn(actual.resolveDestination),
    labelMatchesAllowlist: actual.labelMatchesAllowlist,
  };
});

// All imports must be after vi.mock declarations (hoisted) but before describe blocks
import { isMergeConflicted, webhooks, seenDeliveries } from "./webhooks.js";
import { config, resolveDestination } from "../config.js";
import { sendMessage } from "../telegram/client.js";

const mockFetch = vi.fn();
global.fetch = mockFetch;

const mockSendMessage = sendMessage as ReturnType<typeof vi.fn>;
const mockResolveDestination = resolveDestination as ReturnType<typeof vi.fn>;

// ── isMergeConflicted unit tests ─────────────────────────────────────

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

function makeIssuePayload(labels: string[] = [], action = "opened") {
  return {
    action,
    issue: {
      number: 1,
      title: "Test issue",
      html_url: "https://github.com/owner/repo/issues/1",
      labels: labels.map((name) => ({ name })),
    },
    repository: { full_name: "owner/repo" },
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
    repository: { full_name: "owner/repo" },
  };
}

// ── Label-filter gate — issues events ────────────────────────────────

describe("label-filter gate — issues events", () => {
  beforeEach(() => {
    mockSendMessage.mockClear();
    mockResolveDestination.mockClear();
    seenDeliveries.clear();
  });

  it("forwards issue event when no allowlist is configured", async () => {
    mockResolveDestination.mockReturnValue({ chatId: "-1000000", threadId: undefined });
    await webhooks.receive({ id: "iss-1", name: "issues", payload: makeIssuePayload(["bug"]) });
    expect(mockSendMessage).toHaveBeenCalledOnce();
  });

  it("forwards issue event when payload label matches allowlist", async () => {
    mockResolveDestination.mockReturnValue({ chatId: "-1000000", threadId: undefined, labels: ["urgent", "bug"] });
    await webhooks.receive({ id: "iss-2", name: "issues", payload: makeIssuePayload(["bug"]) });
    expect(mockSendMessage).toHaveBeenCalledOnce();
  });

  it("suppresses issue event when payload label does not match allowlist", async () => {
    mockResolveDestination.mockReturnValue({ chatId: "-1000000", threadId: undefined, labels: ["urgent"] });
    await webhooks.receive({ id: "iss-3", name: "issues", payload: makeIssuePayload(["bug"]) });
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it("suppresses issue event when payload has zero labels and allowlist is set", async () => {
    mockResolveDestination.mockReturnValue({ chatId: "-1000000", threadId: undefined, labels: ["urgent"] });
    await webhooks.receive({ id: "iss-4", name: "issues", payload: makeIssuePayload([]) });
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it("is case-sensitive: 'Urgent' does not match 'urgent' allowlist", async () => {
    mockResolveDestination.mockReturnValue({ chatId: "-1000000", threadId: undefined, labels: ["urgent"] });
    await webhooks.receive({ id: "iss-5", name: "issues", payload: makeIssuePayload(["Urgent"]) });
    expect(mockSendMessage).not.toHaveBeenCalled();
  });
});

// ── Label-filter gate — pull_request events ───────────────────────────

describe("label-filter gate — pull_request events", () => {
  beforeEach(() => {
    mockSendMessage.mockClear();
    mockResolveDestination.mockClear();
    seenDeliveries.clear();
  });

  it("forwards PR opened event when no allowlist is configured", async () => {
    mockResolveDestination.mockReturnValue({ chatId: "-1000000", threadId: undefined });
    await webhooks.receive({ id: "pr-1", name: "pull_request", payload: makePRPayload(["feature"]) });
    expect(mockSendMessage).toHaveBeenCalled();
  });

  it("forwards PR opened event when payload label matches allowlist", async () => {
    mockResolveDestination.mockReturnValue({ chatId: "-1000000", threadId: undefined, labels: ["urgent", "feature"] });
    await webhooks.receive({ id: "pr-2", name: "pull_request", payload: makePRPayload(["feature"]) });
    expect(mockSendMessage).toHaveBeenCalled();
  });

  it("suppresses PR opened event when payload label does not match allowlist", async () => {
    mockResolveDestination.mockReturnValue({ chatId: "-1000000", threadId: undefined, labels: ["urgent"] });
    await webhooks.receive({ id: "pr-3", name: "pull_request", payload: makePRPayload(["bug"]) });
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it("suppresses PR opened event when payload has zero labels and allowlist is set", async () => {
    mockResolveDestination.mockReturnValue({ chatId: "-1000000", threadId: undefined, labels: ["urgent"] });
    await webhooks.receive({ id: "pr-4", name: "pull_request", payload: makePRPayload([]) });
    expect(mockSendMessage).not.toHaveBeenCalled();
  });
});
