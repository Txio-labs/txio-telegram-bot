import { describe, it, expect, vi, beforeEach } from "vitest";

vi.hoisted(() => {
  process.env.TELEGRAM_BOT_TOKEN = "fake:token";
  process.env.TELEGRAM_CHAT_ID = "-1000000";
  process.env.TELEGRAM_WEBHOOK_SECRET = "fake-webhook-secret";
  process.env.GITHUB_WEBHOOK_SECRET = "fake-github-secret";
  process.env.PUBLIC_URL = "https://example.com";
  process.env.STALE_REMINDER_CRON = "0 9 * * *";
  process.env.STALE_THRESHOLD_DAYS = "7";
  process.env.STALE_REPO_NAMES = "txio-labs/txio-backend,txio-labs/txio-cli";
});

vi.mock("node-cron", () => ({
  schedule: vi.fn(() => ({
    start: vi.fn(),
    stop: vi.fn(),
    getStatus: vi.fn(() => "scheduled"),
  })),
  validate: vi.fn(() => true),
}));

vi.mock("./stale.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./stale.js")>()),
  collectStaleItems: vi.fn(),
}));

vi.mock("./telegram/client.js", () => ({
  sendMessage: vi.fn(),
}));

import { schedule, validate } from "node-cron";
import { config } from "./config.js";
import { startScheduler, stopScheduler, runStaleCheck } from "./scheduler.js";
import { collectStaleItems } from "./stale.js";
import { sendMessage } from "./telegram/client.js";

const mockSchedule = vi.mocked(schedule);
const mockValidate = vi.mocked(validate);
const mockCollect = vi.mocked(collectStaleItems);
const mockSendMessage = vi.mocked(sendMessage);

function staleItem(repoFullName: string, number: number) {
  return {
    repoFullName,
    number,
    title: "Old PR",
    htmlUrl: `https://github.com/${repoFullName}/issues/${number}`,
    updatedAt: "2026-08-01T12:00:00Z",
    isPullRequest: false,
    author: "alice",
  };
}

describe("startScheduler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stopScheduler();
  });

  it("registers a cron job using the configured schedule", () => {
    startScheduler();

    expect(mockValidate).toHaveBeenCalledWith(config.staleReminder.cron);
    expect(mockSchedule).toHaveBeenCalledWith(
      config.staleReminder.cron,
      expect.any(Function),
    );
  });

  it("does not double-register the job on repeated calls", () => {
    startScheduler();
    startScheduler();

    expect(mockSchedule).toHaveBeenCalledTimes(1);
  });

  it("logs and skips registration for an invalid cron expression", () => {
    mockValidate.mockReturnValueOnce(false);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    startScheduler();

    expect(mockSchedule).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Invalid STALE_REMINDER_CRON"));
    errorSpy.mockRestore();
  });

  it("can be restarted after stopScheduler", () => {
    startScheduler();
    stopScheduler();
    startScheduler();

    expect(mockSchedule).toHaveBeenCalledTimes(2);
  });
});

describe("runStaleCheck", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("posts a single digest message with all stale items", async () => {
    mockCollect.mockResolvedValueOnce([
      staleItem("txio-labs/txio-backend", 1),
      staleItem("txio-labs/txio-backend", 2),
    ]);

    const sent = await runStaleCheck(new Date("2026-08-20T12:00:00Z"));

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    const [chatId, text] = mockSendMessage.mock.calls[0];
    expect(chatId).toBe("-1000000");
    expect(text).toContain("#1 Old PR");
    expect(text).toContain("#2 Old PR");
    expect(sent).toBe(1);
  });

  it("sends nothing when no items are stale", async () => {
    mockCollect.mockResolvedValueOnce([]);

    const sent = await runStaleCheck(new Date("2026-08-20T12:00:00Z"));

    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(sent).toBe(0);
  });

  it("skips the check when no repos are tracked", async () => {
    const reposSpy = vi.spyOn(config.staleReminder, "repos", "get").mockReturnValue([]);

    const sent = await runStaleCheck(new Date("2026-08-20T12:00:00Z"));

    expect(mockCollect).not.toHaveBeenCalled();
    expect(sent).toBe(0);
    reposSpy.mockRestore();
  });

  it("logs and continues when sending a digest fails", async () => {
    mockCollect.mockResolvedValueOnce([staleItem("txio-labs/txio-backend", 1)]);
    mockSendMessage.mockRejectedValueOnce(new Error("chat not found"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const sent = await runStaleCheck(new Date("2026-08-20T12:00:00Z"));

    expect(sent).toBe(0);
    expect(errorSpy).toHaveBeenCalledWith(
      "Failed to send stale digest to chat -1000000:",
      expect.any(Error),
    );
    errorSpy.mockRestore();
  });

  it("passes the configured repos, token and threshold to the collector", async () => {
    mockCollect.mockResolvedValueOnce([]);

    await runStaleCheck(new Date("2026-08-20T12:00:00Z"));

    expect(mockCollect).toHaveBeenCalledWith(
      config.staleReminder.repos,
      expect.objectContaining({
        token: config.githubToken,
        thresholdDays: 7,
        now: new Date("2026-08-20T12:00:00Z"),
      }),
    );
  });

  it("groups items into one digest per destination chat", async () => {
    mockCollect.mockResolvedValueOnce([
      staleItem("txio-labs/txio-backend", 1),
      staleItem("txio-labs/txio-cli", 2),
    ]);

    await runStaleCheck(new Date("2026-08-20T12:00:00Z"));

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    const [chatId, text] = mockSendMessage.mock.calls[0];
    expect(chatId).toBe("-1000000");
    expect(text).toContain("#1 Old PR");
    expect(text).toContain("#2 Old PR");
  });
});