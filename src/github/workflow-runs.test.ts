import { describe, it, expect } from "vitest";
import type { EmitterWebhookEvent } from "@octokit/webhooks";
import { formatWorkflowRunEvent } from "./formatters.js";

function workflowRunEvent(
  status: string,
  conclusion: string | null,
  overrides: Record<string, unknown> = {},
): EmitterWebhookEvent<"workflow_run"> {
  return {
    id: "1",
    name: "workflow_run",
    payload: {
      action: "completed",
      workflow_run: {
        name: "CI",
        status,
        conclusion,
        html_url: "https://github.com/txio-labs/txio-backend/actions/runs/123",
        head_branch: "main",
        ...overrides,
      },
      repository: {
        full_name: "txio-labs/txio-backend",
        html_url: "https://github.com/txio-labs/txio-backend",
      },
    },
  } as unknown as EmitterWebhookEvent<"workflow_run">;
}

describe("formatWorkflowRunEvent", () => {
  it("formats a completed successful run", () => {
    const text = formatWorkflowRunEvent(workflowRunEvent("completed", "success"));

    expect(text).toContain("✅");
    expect(text).toContain("CI success");
    expect(text).toContain("<a href=");
    expect(text).toContain("txio-labs/txio-backend");
    expect(text).toContain("main");
  });

  it("formats a cancelled run with a neutral icon", () => {
    const text = formatWorkflowRunEvent(workflowRunEvent("completed", "cancelled"));

    expect(text).toContain("⚪");
    expect(text).toContain("CI cancelled");
    expect(text).toContain("<a href=");
    expect(text).toContain("main");
  });

  it("formats a failed run with an error icon", () => {
    const text = formatWorkflowRunEvent(workflowRunEvent("completed", "failure"));

    expect(text).toContain("❌");
    expect(text).toContain("CI failure");
  });

  it("returns null for runs that have not completed", () => {
    expect(formatWorkflowRunEvent(workflowRunEvent("requested", null))).toBeNull();
    expect(formatWorkflowRunEvent(workflowRunEvent("in_progress", null))).toBeNull();
    expect(formatWorkflowRunEvent(workflowRunEvent("queued", null))).toBeNull();
  });

  it("does not throw when a completed run has a null conclusion", () => {
    const text = formatWorkflowRunEvent(workflowRunEvent("completed", null));

    expect(text).not.toBeNull();
    expect(text).toContain("❌");
  });

  it("falls back to unknown when the head branch is missing", () => {
    const text = formatWorkflowRunEvent(
      workflowRunEvent("completed", "success", { head_branch: null }),
    );

    expect(text).toContain("unknown");
  });

  it("falls back to the workflow label when the run name is missing", () => {
    const text = formatWorkflowRunEvent(
      workflowRunEvent("completed", "success", { name: null }),
    );

    expect(text).toContain(">workflow</a>");
  });
});