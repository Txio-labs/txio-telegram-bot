import { describe, expect, it } from "vitest";
import {
  formatDeploymentStatusEvent,
  formatIssueEvent,
  formatMergeConflictEvent,
  formatPullRequestEvent,
  formatWorkflowRunEvent,
} from "./formatters.js";

type IssueEvent = Parameters<typeof formatIssueEvent>[0];
type PullRequestEvent = Parameters<typeof formatPullRequestEvent>[0];
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
    expect(formatIssueEvent(issueEvent(action))).toBe(
      `${icon} Issue ${action} in <a href="https://github.com/txio/repo">txio/repo</a>\n` +
        `<a href="https://github.com/txio/repo/issues/7">#7 Fix &lt;alerts&gt;</a>\n` +
        "by octo&amp;cat",
    );
  });
});

describe("formatPullRequestEvent", () => {
  it.each([
    ["opened", false, "🆕", "opened"],
    ["reopened", false, "🔁", "reopened"],
    ["closed", false, "❌", "closed"],
    ["closed", true, "🎉", "merged"],
  ] as const)("formats a %s pull request (merged: %s)", (action, merged, icon, label) => {
    expect(formatPullRequestEvent(pullRequestEvent(action, merged))).toBe(
      `${icon} Pull request ${label} in <a href="https://github.com/txio/repo">txio/repo</a>\n` +
        `<a href="https://github.com/txio/repo/pull/8">#8 Ship &lt;feature&gt;</a>\n` +
        "by octo&amp;cat",
    );
  });
});

describe("formatMergeConflictEvent", () => {
  it("formats a merge conflict", () => {
    expect(
      formatMergeConflictEvent(
        { html_url: "https://github.com/txio/repo/pull/8", number: 8, title: "Ship <feature>" },
        repository,
      ),
    ).toBe(
      `⚠️ Merge conflict on <a href="https://github.com/txio/repo">txio/repo</a>\n` +
        `<a href="https://github.com/txio/repo/pull/8">#8 Ship &lt;feature&gt;</a> can't be merged — needs to be updated with the base branch.`,
    );
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
    expect(formatDeploymentStatusEvent(deploymentStatusEvent(state, "https://deploy.test/log"))).toBe(
      `${icon} Deploy ${state} — preview &lt;west&gt; (<a href="https://github.com/txio/repo">txio/repo</a>)\n` +
        `<a href="https://deploy.test/log">logs</a>`,
    );
  });

  it("omits the logs link when no log URL is provided", () => {
    expect(formatDeploymentStatusEvent(deploymentStatusEvent("pending"))).toBe(
      `⏳ Deploy pending — preview &lt;west&gt; (<a href="https://github.com/txio/repo">txio/repo</a>)\n`,
    );
  });
});
