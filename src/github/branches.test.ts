import { describe, it, expect, vi, beforeEach } from "vitest";
import type { EmitterWebhookEvent } from "@octokit/webhooks";

vi.hoisted(() => {
  process.env.TELEGRAM_BOT_TOKEN = "fake:token";
  process.env.TELEGRAM_CHAT_ID = "-1000000";
  process.env.TELEGRAM_WEBHOOK_SECRET = "fake-webhook-secret";
  process.env.GITHUB_WEBHOOK_SECRET = "fake-github-secret";
  process.env.PUBLIC_URL = "https://example.com";
});

vi.mock("../telegram/client.js", () => ({
  sendMessage: vi.fn(),
}));

import { webhooks, isBranchRef, isForcePushToDefaultBranch } from "./webhooks.js";
import { sendMessage } from "../telegram/client.js";
import {
  formatBranchCreatedEvent,
  formatBranchDeletedEvent,
  formatForcePushEvent,
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

describe("isBranchRef", () => {
  it("returns true for branch refs", () => {
    expect(isBranchRef("branch")).toBe(true);
  });

  it("returns false for tag refs", () => {
    expect(isBranchRef("tag")).toBe(false);
  });

  it("returns false when ref_type is missing", () => {
    expect(isBranchRef(undefined)).toBe(false);
  });
});

describe("isForcePushToDefaultBranch", () => {
  it("returns true for a forced push to the default branch", () => {
    expect(isForcePushToDefaultBranch("refs/heads/main", true, "main")).toBe(true);
  });

  it("returns false for a non-forced push to the default branch", () => {
    expect(isForcePushToDefaultBranch("refs/heads/main", false, "main")).toBe(false);
  });

  it("returns false for a forced push to a non-default branch", () => {
    expect(isForcePushToDefaultBranch("refs/heads/feature/foo", true, "main")).toBe(false);
  });

  it("matches non-main default branch names", () => {
    expect(isForcePushToDefaultBranch("refs/heads/master", true, "master")).toBe(true);
  });

  it("returns false when forced is missing", () => {
    expect(isForcePushToDefaultBranch("refs/heads/main", undefined, "main")).toBe(false);
  });

  it("returns false when default_branch is missing", () => {
    expect(isForcePushToDefaultBranch("refs/heads/main", true, undefined)).toBe(false);
  });
});

describe("branch create/delete handlers", () => {
  beforeEach(() => {
    mockSendMessage.mockClear();
  });

  it("posts a notification when a branch is created", async () => {
    await receive("create", {
      ref: "feature/foo",
      ref_type: "branch",
      master_branch: "main",
      pusher_type: "user",
      repository: repository(),
      sender: { login: "alice" },
    });

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    const [chatId, text] = mockSendMessage.mock.calls[0];
    expect(chatId).toBe("-1000000");
    expect(text).toContain("Branch created");
    expect(text).toContain("feature/foo");
    expect(text).toContain("alice");
  });

  it("ignores tag creation", async () => {
    await receive("create", {
      ref: "v1.0.0",
      ref_type: "tag",
      master_branch: "main",
      pusher_type: "user",
      repository: repository(),
      sender: { login: "alice" },
    });

    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it("posts a notification when a branch is deleted", async () => {
    await receive("delete", {
      ref: "feature/foo",
      ref_type: "branch",
      pusher_type: "user",
      repository: repository(),
      sender: { login: "alice" },
    });

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    const [chatId, text] = mockSendMessage.mock.calls[0];
    expect(chatId).toBe("-1000000");
    expect(text).toContain("Branch deleted");
    expect(text).toContain("feature/foo");
  });

  it("ignores tag deletion", async () => {
    await receive("delete", {
      ref: "v1.0.0",
      ref_type: "tag",
      pusher_type: "user",
      repository: repository(),
      sender: { login: "alice" },
    });

    expect(mockSendMessage).not.toHaveBeenCalled();
  });
});

describe("push handler", () => {
  beforeEach(() => {
    mockSendMessage.mockClear();
  });

  it("posts a clearly-flagged warning for a force push to the default branch", async () => {
    await receive("push", {
      ref: "refs/heads/main",
      forced: true,
      created: false,
      deleted: false,
      before: "abc123",
      after: "def456",
      compare: "https://github.com/txio-labs/txio-backend/compare/abc123...def456",
      repository: repository(),
      sender: { login: "alice" },
    });

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    const [chatId, text] = mockSendMessage.mock.calls[0];
    expect(chatId).toBe("-1000000");
    expect(text).toContain("Force push");
    expect(text).toContain("main");
    expect(text).toContain("alice");
  });

  it("ignores ordinary (non-forced) pushes to the default branch", async () => {
    await receive("push", {
      ref: "refs/heads/main",
      forced: false,
      created: false,
      deleted: false,
      before: "abc123",
      after: "def456",
      compare: "https://github.com/txio-labs/txio-backend/compare/abc123...def456",
      repository: repository(),
      sender: { login: "alice" },
    });

    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it("ignores force pushes to non-default branches", async () => {
    await receive("push", {
      ref: "refs/heads/feature/foo",
      forced: true,
      created: false,
      deleted: false,
      before: "abc123",
      after: "def456",
      compare: "https://github.com/txio-labs/txio-backend/compare/abc123...def456",
      repository: repository(),
      sender: { login: "alice" },
    });

    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it("alerts on force pushes when the default branch is not main", async () => {
    await receive("push", {
      ref: "refs/heads/master",
      forced: true,
      created: false,
      deleted: false,
      before: "abc123",
      after: "def456",
      compare: "https://github.com/txio-labs/txio-backend/compare/abc123...def456",
      repository: repository({ default_branch: "master" }),
      sender: { login: "alice" },
    });

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    const [, text] = mockSendMessage.mock.calls[0];
    expect(text).toContain("Force push");
    expect(text).toContain("master");
  });

  it("ignores force pushes when the ref is a tag", async () => {
    await receive("push", {
      ref: "refs/tags/v1.0.0",
      forced: true,
      created: false,
      deleted: false,
      before: "abc123",
      after: "def456",
      compare: "https://github.com/txio-labs/txio-backend/compare/abc123...def456",
      repository: repository(),
      sender: { login: "alice" },
    });

    expect(mockSendMessage).not.toHaveBeenCalled();
  });
});

describe("formatters", () => {
  it("formats a branch-created event with an HTML link", () => {
    const text = formatBranchCreatedEvent({
      id: "1",
      name: "create",
      payload: {
        ref: "feature/foo",
        ref_type: "branch",
        master_branch: "main",
        pusher_type: "user",
        repository: repository() as never,
        sender: { login: "alice" } as never,
      },
    } as unknown as EmitterWebhookEvent<"create">);

    expect(text).toContain("<a href=");
    expect(text).toContain("txio-labs/txio-backend");
    expect(text).toContain("feature/foo");
  });

  it("formats a branch-deleted event", () => {
    const text = formatBranchDeletedEvent({
      id: "1",
      name: "delete",
      payload: {
        ref: "feature/foo",
        ref_type: "branch",
        pusher_type: "user",
        repository: repository() as never,
        sender: { login: "alice" } as never,
      },
    } as unknown as EmitterWebhookEvent<"delete">);

    expect(text).toContain("Branch deleted");
    expect(text).toContain("feature/foo");
  });

  it("formats a force-push event with a compare link and strips the refs/heads prefix", () => {
    const text = formatForcePushEvent({
      id: "1",
      name: "push",
      payload: {
        ref: "refs/heads/main",
        forced: true,
        created: false,
        deleted: false,
        before: "abc123",
        after: "def456",
        compare: "https://github.com/txio-labs/txio-backend/compare/abc123...def456",
        repository: repository() as never,
        sender: { login: "alice" } as never,
      },
    } as unknown as EmitterWebhookEvent<"push">);

    expect(text).toContain("Force push");
    expect(text).toContain("main");
    expect(text).not.toContain("refs/heads");
    expect(text).toContain("view changes");
  });
});