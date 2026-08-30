import { describe, expect, it } from "vitest";
import {
  formatDeploymentStatusEvent,
  formatIssueEvent,
  formatMergeConflictEvent,
  formatPullRequestClosedEvent,
  formatPullRequestOpenedEvent,
  formatWorkflowRunEvent,
} from "./formatters.js";

type IssueEvent = Parameters<typeof formatIssueEvent>[0];
type PullRequestEvent = Parameters<typeof formatPullRequestClosedEvent>[0];
type WorkflowRunEvent = Parameters<typeof formatWorkflowRunEvent>[0];
type DeploymentStatusEvent = Parameters<typeof formatDeploymentStatusEvent>[0];

const repository = {
  html_url: "https://github.com/txio/repo",
  full_name: "txio/repo",
};

function issueEvent(action: "opened" | "closed" | "reopened"): IssueEvent {
  return {
    payload: {
      action,
      repository,
      issue: {
        html_url: "https://github.com/txio/repo/issues/7",
        number: 7,
        title: "Fix <alerts>",
        user: { login: "octo&cat" },
      },
    },
  } as IssueEvent;
}

function pullRequestEvent(
  action: "opened" | "closed" | "reopened",
  merged = false,
): PullRequestEvent {
  return {
    payload: {
      action,
      repository,
      pull_request: {
        html_url: "https://github.com/txio/repo/pull/8",
        number: 8,
        title: "Ship <feature>",
        merged,
        user: { login: "octo&cat" },
      },
    },
  } as PullRequestEvent;
}

function workflowRunEvent(status: string, conclusion: string | null): WorkflowRunEvent {
  return {
    payload: {
      repository,
      workflow_run: {
        status,
        conclusion,
        html_url: "https://github.com/txio/repo/actions/runs/9",
        name: "Checks <all>",
        head_branch: "feature/a&b",
      },
    },
  } as WorkflowRunEvent;
}

function deploymentStatusEvent(state: string, logUrl = ""): DeploymentStatusEvent {
  return {
    payload: {
      repository,
      deployment: { environment: "preview <west>" },
      deployment_status: { state, log_url: logUrl },
    },
  } as DeploymentStatusEvent;
}

describe("formatIssueEvent", () => {
  it.each([
    ["opened", "🆕"],
    ["closed", "✅"],
    ["reopened", "🔁"],
  ] as const)("formats an %s issue", (action, icon) => {
    const result = formatIssueEvent(issueEvent(action), "markdown_summary");
    expect(result).toEqual({
      text:
        `${icon} Issue ${action} in <a href="https://github.com/txio/repo">txio/repo</a>\n` +
        `<a href="https://github.com/txio/repo/issues/7">#7 Fix &lt;alerts&gt;</a>\n` +
        "by octo&amp;cat",
      parseMode: "HTML",
    });
  });

  it("formats in plain_text mode", () => {
    const result = formatIssueEvent(issueEvent("opened"), "plain_text");
    expect(result.parseMode).toBeUndefined();
    expect(result.text).toContain("Fix <alerts>");
  });

  it("formats in inline_buttons mode", () => {
    const result = formatIssueEvent(issueEvent("opened"), "inline_buttons");
    expect(result.parseMode).toBe("HTML");
    expect(result.replyMarkup).toBeDefined();
  });
});

describe("formatPullRequestClosedEvent", () => {
  it.each([
    ["reopened", false, "🔁", "reopened"],
    ["closed", false, "❌", "closed"],
    ["closed", true, "🎉", "merged"],
  ] as const)("formats a %s pull request (merged: %s)", (action, merged, icon, label) => {
    const result = formatPullRequestClosedEvent(pullRequestEvent(action, merged), "markdown_summary");
    expect(result).toEqual({
      text:
        `${icon} Pull request ${label} in <a href="https://github.com/txio/repo">txio/repo</a>\n` +
        `<a href="https://github.com/txio/repo/pull/8">#8 Ship &lt;feature&gt;</a>\n` +
        "by octo&amp;cat",
      parseMode: "HTML",
    });
  });
});

describe("formatPullRequestOpenedEvent", () => {
  it("formats an opened pull request", () => {
    const result = formatPullRequestOpenedEvent(pullRequestEvent("opened"), "markdown_summary");
    expect(result).toEqual({
      text:
        `🆕 Pull request opened in <a href="https://github.com/txio/repo">txio/repo</a>\n` +
        `<a href="https://github.com/txio/repo/pull/8">#8 Ship &lt;feature&gt;</a>\n` +
        "by octo&amp;cat",
      parseMode: "HTML",
    });
  });
});

describe("formatMergeConflictEvent", () => {
  it("formats a merge conflict", () => {
    const result = formatMergeConflictEvent(
      { html_url: "https://github.com/txio/repo/pull/8", number: 8, title: "Ship <feature>" },
      repository,
      "markdown_summary",
    );
    expect(result).toEqual({
      text:
        `⚠️ Merge conflict on <a href="https://github.com/txio/repo">txio/repo</a>\n` +
        `<a href="https://github.com/txio/repo/pull/8">#8 Ship &lt;feature&gt;</a> can't be merged — needs to be updated with the base branch.`,
      parseMode: "HTML",
    });
  });
});

describe("formatWorkflowRunEvent", () => {
  it.each([
    ["success", "✅"],
    ["failure", "❌"],
    ["cancelled", "⚪"],
  ] as const)("formats a completed %s run", (conclusion, icon) => {
    expect(formatWorkflowRunEvent(workflowRunEvent("completed", conclusion))).toBe(
      `${icon} CI ${conclusion} for <a href="https://github.com/txio/repo">txio/repo</a>\n` +
        `<a href="https://github.com/txio/repo/actions/runs/9">Checks &lt;all&gt;</a> on feature/a&amp;b`,
    );
  });

  it("returns null for a non-completed run", () => {
    expect(formatWorkflowRunEvent(workflowRunEvent("in_progress", null))).toBeNull();
  });
});

describe("formatDeploymentStatusEvent", () => {
  it.each([
    ["success", "🚀"],
    ["failure", "❌"],
    ["error", "❌"],
    ["pending", "⏳"],
  ] as const)("formats a %s deployment", (state, icon) => {
    const result = formatDeploymentStatusEvent(deploymentStatusEvent(state, "https://deploy.test/log"), "markdown_summary");
    expect(result).toEqual({
      text:
        `${icon} Deploy ${state} — preview &lt;west&gt; (<a href="https://github.com/txio/repo">txio/repo</a>)\n` +
        `<a href="https://deploy.test/log">logs</a>`,
      parseMode: "HTML",
    });
  });

  it("omits the logs link when no log URL is provided", () => {
    const result = formatDeploymentStatusEvent(deploymentStatusEvent("pending"), "markdown_summary");
    expect(result).toEqual({
      text: `⏳ Deploy pending — preview &lt;west&gt; (<a href="https://github.com/txio/repo">txio/repo</a>)\n`,
      parseMode: "HTML",
    });
  });
});
