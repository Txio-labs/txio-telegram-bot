import { describe, it, expect, vi, beforeEach } from "vitest";
import type { EmitterWebhookEvent } from "@octokit/webhooks";

vi.hoisted(() => {
  process.env.TELEGRAM_BOT_TOKEN = "fake:token";
  process.env.TELEGRAM_CHAT_ID = "-1000000";
  process.env.TELEGRAM_WEBHOOK_SECRET = "fake-webhook-secret";
  process.env.GITHUB_WEBHOOK_SECRET = "fake-github-secret";
  process.env.PUBLIC_URL = "https://example.com";
  process.env.TOPIC_THREAD_ISSUES = "101";
  process.env.TOPIC_THREAD_PULL_REQUESTS = "102";
});

vi.mock("../telegram/client.js", () => ({
  sendMessage: vi.fn(),
}));

import { webhooks } from "./webhooks.js";
import { sendMessage } from "../telegram/client.js";
import {
  formatCommentEvent,
  truncateCommentBody,
  COMMENT_PREVIEW_LENGTH,
} from "./formatters.js";

const mockSendMessage = vi.mocked(sendMessage);

let deliveryId = 0;
function receive(name: string, payload: Record<string, unknown>): Promise<void> {
  deliveryId += 1;
  return webhooks.receive({ id: `delivery-${deliveryId}`, name, payload } as EmitterWebhookEvent);
}

function repository(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    full_name: "txio-labs/txio-backend",
    html_url: "https://github.com/txio-labs/txio-backend",
    default_branch: "main",
    ...overrides,
  };
}

function commentPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    action: "created",
    issue: {
      number: 12,
      title: "Some issue",
      html_url: "https://github.com/txio-labs/txio-backend/issues/12",
    },
    comment: {
      body: "hello",
      html_url: "https://github.com/txio-labs/txio-backend/issues/12#issuecomment-1",
      user: { login: "alice", type: "User" },
    },
    repository: repository(),
    sender: { login: "alice" },
    ...overrides,
  };
}

describe("truncateCommentBody", () => {
  it("collapses whitespace and trims", () => {
    expect(truncateCommentBody("  line one\n\n  line two  ")).toBe("line one line two");
  });

  it("leaves short bodies untouched", () => {
    const body = "short comment";
    expect(truncateCommentBody(body)).toBe(body);
  });

  it("truncates long bodies with an ellipsis", () => {
    const body = "a".repeat(COMMENT_PREVIEW_LENGTH + 50);
    const result = truncateCommentBody(body);
    expect(result).toHaveLength(COMMENT_PREVIEW_LENGTH + 1);
    expect(result.endsWith("…")).toBe(true);
  });

  it("handles an empty body", () => {
    expect(truncateCommentBody("")).toBe("");
  });
});

describe("formatCommentEvent", () => {
  it("formats an issue comment as an issue notification", () => {
    const text = formatCommentEvent({
      id: "1",
      name: "issue_comment",
      payload: commentPayload() as never,
    } as unknown as EmitterWebhookEvent<"issue_comment">);

    expect(text).toContain("Comment on Issue");
    expect(text).toContain("<a href=");
    expect(text).toContain("txio-labs/txio-backend");
    expect(text).toContain("#12 Some issue");
    expect(text).toContain("alice: hello");
    expect(text).not.toContain("Pull request");
  });

  it("formats a comment on a pull request as a PR notification", () => {
    const text = formatCommentEvent({
      id: "1",
      name: "issue_comment",
      payload: commentPayload({
        issue: {
          number: 12,
          title: "Some issue",
          html_url: "https://github.com/txio-labs/txio-backend/issues/12",
          pull_request: { url: "https://api.github.com/repos/txio-labs/txio-backend/pulls/12" },
        },
      }) as never,
    } as unknown as EmitterWebhookEvent<"issue_comment">);

    expect(text).toContain("Comment on Pull request");
    expect(text).toContain("#12 Some issue");
    expect(text).not.toContain("Comment on Issue");
  });

  it("escapes HTML-significant characters in the body", () => {
    const text = formatCommentEvent({
      id: "1",
      name: "issue_comment",
      payload: commentPayload({
        comment: {
          body: "a <script>alert('x')</script> & more",
          html_url: "https://github.com/txio-labs/txio-backend/issues/12#issuecomment-1",
          user: { login: "alice", type: "User" },
        },
      }) as never,
    } as unknown as EmitterWebhookEvent<"issue_comment">);

    expect(text).toContain("&lt;script&gt;");
    expect(text).toContain("&amp;");
    expect(text).not.toContain("<script>");
  });

  it("truncates long comment bodies in the notification", () => {
    const longBody = "x".repeat(COMMENT_PREVIEW_LENGTH + 50);
    const text = formatCommentEvent({
      id: "1",
      name: "issue_comment",
      payload: commentPayload({
        comment: {
          body: longBody,
          html_url: "https://github.com/txio-labs/txio-backend/issues/12#issuecomment-1",
          user: { login: "alice", type: "User" },
        },
      }) as never,
    } as unknown as EmitterWebhookEvent<"issue_comment">);

    expect(text).toContain("…");
    expect(text).not.toContain(longBody);
  });

  it("falls back to unknown author when the user is missing", () => {
    const text = formatCommentEvent({
      id: "1",
      name: "issue_comment",
      payload: commentPayload({
        comment: {
          body: "hello",
          html_url: "https://github.com/txio-labs/txio-backend/issues/12#issuecomment-1",
          user: null,
        },
      }) as never,
    } as unknown as EmitterWebhookEvent<"issue_comment">);

    expect(text).toContain("unknown: hello");
  });
});

describe("issue_comment.created handler", () => {
  beforeEach(() => {
    mockSendMessage.mockClear();
  });

  it("posts an issue comment to the issues topic thread", async () => {
    await receive("issue_comment.created", commentPayload());

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    const [chatId, text, threadId] = mockSendMessage.mock.calls[0];
    expect(chatId).toBe("-1000000");
    expect(threadId).toBe(101);
    expect(text).toContain("Comment on Issue");
  });

  it("posts a PR comment to the pull requests topic thread", async () => {
    await receive(
      "issue_comment.created",
      commentPayload({
        issue: {
          number: 12,
          title: "Some issue",
          html_url: "https://github.com/txio-labs/txio-backend/issues/12",
          pull_request: { url: "https://api.github.com/repos/txio-labs/txio-backend/pulls/12" },
        },
      }),
    );

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    const [chatId, text, threadId] = mockSendMessage.mock.calls[0];
    expect(chatId).toBe("-1000000");
    expect(threadId).toBe(102);
    expect(text).toContain("Comment on Pull request");
  });

  it("ignores comments authored by bots", async () => {
    await receive(
      "issue_comment.created",
      commentPayload({
        comment: {
          body: "auto-generated",
          html_url: "https://github.com/txio-labs/txio-backend/issues/12#issuecomment-1",
          user: { login: "dependabot[bot]", type: "Bot" },
        },
      }),
    );

    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it("ignores duplicate deliveries", async () => {
    const payload = commentPayload();
    await webhooks.receive({ id: "duplicate-delivery", name: "issue_comment.created", payload } as unknown as EmitterWebhookEvent);
    await webhooks.receive({ id: "duplicate-delivery", name: "issue_comment.created", payload } as unknown as EmitterWebhookEvent);

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
  });
});