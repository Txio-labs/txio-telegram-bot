import { describe, it, expect } from "vitest";
import type { RepoSummary, PullRequestDetail, CombinedStatus, CheckRun } from "./api.js";
import {
  formatRepoSummary,
  formatPullRequestDetail,
  formatRepoNotFound,
  formatPrNotFound,
  formatApiError,
} from "./command-formatters.js";

const mockRepo: RepoSummary = {
  full_name: "txio-labs/txio-backend",
  html_url: "https://github.com/txio-labs/txio-backend",
  description: "Backend service for Txio",
  stargazers_count: 128,
  forks_count: 14,
  open_issues_count: 5,
  language: "TypeScript",
  openPullRequests: 7,
};

const mockPr: PullRequestDetail = {
  number: 42,
  title: "Add user authentication",
  state: "open",
  merged: false,
  html_url: "https://github.com/txio-labs/txio-backend/pull/42",
  user: { login: "contributor" },
  draft: false,
};

const mockStatus: CombinedStatus = {
  state: "success",
  total_count: 3,
};

describe("formatRepoSummary", () => {
  it("includes stars, forks, issues, and PRs", () => {
    const result = formatRepoSummary(mockRepo);
    expect(result).toContain("128");
    expect(result).toContain("14");
    expect(result).toContain("5");
    expect(result).toContain("7");
  });

  it("includes repo link", () => {
    const result = formatRepoSummary(mockRepo);
    expect(result).toContain("https://github.com/txio-labs/txio-backend");
    expect(result).toContain("txio-labs/txio-backend");
  });

  it("includes language when present", () => {
    const result = formatRepoSummary(mockRepo);
    expect(result).toContain("TypeScript");
  });

  it("includes description when present", () => {
    const result = formatRepoSummary(mockRepo);
    expect(result).toContain("Backend service for Txio");
  });

  it("handles null language", () => {
    const repo = { ...mockRepo, language: null };
    const result = formatRepoSummary(repo);
    expect(result).not.toContain("TypeScript");
  });

  it("handles null description", () => {
    const repo = { ...mockRepo, description: null };
    const result = formatRepoSummary(repo);
    expect(result).not.toContain("Backend service for Txio");
  });
});

describe("formatPullRequestDetail", () => {
  it("shows open PR with correct icon", () => {
    const result = formatPullRequestDetail(mockPr, mockStatus, []);
    expect(result).toContain("🟢");
    expect(result).toContain("open");
  });

  it("shows merged PR with correct icon", () => {
    const pr = { ...mockPr, merged: true };
    const result = formatPullRequestDetail(pr, mockStatus, []);
    expect(result).toContain("🎉");
    expect(result).toContain("merged");
  });

  it("shows closed PR with correct icon", () => {
    const pr = { ...mockPr, state: "closed" as const };
    const result = formatPullRequestDetail(pr, mockStatus, []);
    expect(result).toContain("🔴");
    expect(result).toContain("closed");
  });

  it("shows draft indicator", () => {
    const pr = { ...mockPr, draft: true };
    const result = formatPullRequestDetail(pr, mockStatus, []);
    expect(result).toContain("(draft)");
  });

  it("shows CI passing when all checks succeed", () => {
    const result = formatPullRequestDetail(mockPr, mockStatus, []);
    expect(result).toContain("✅");
    expect(result).toContain("passing");
  });

  it("shows CI failing when checks fail", () => {
    const status: CombinedStatus = { state: "failure", total_count: 3 };
    const result = formatPullRequestDetail(mockPr, status, []);
    expect(result).toContain("❌");
    expect(result).toContain("failing");
  });

  it("shows CI pending when checks are pending", () => {
    const status: CombinedStatus = { state: "pending", total_count: 0 };
    const result = formatPullRequestDetail(mockPr, status, []);
    expect(result).toContain("⏳");
    expect(result).toContain("pending");
  });

  it("check runs take priority over commit status", () => {
    const checkRuns: CheckRun[] = [
      { status: "completed", conclusion: "failure" },
    ];
    const result = formatPullRequestDetail(mockPr, mockStatus, checkRuns);
    expect(result).toContain("❌");
  });

  it("shows check count when available", () => {
    const result = formatPullRequestDetail(mockPr, mockStatus, []);
    expect(result).toContain("3 checks");
  });

  it("includes author", () => {
    const result = formatPullRequestDetail(mockPr, mockStatus, []);
    expect(result).toContain("contributor");
  });

  it("includes GitHub link", () => {
    const result = formatPullRequestDetail(mockPr, mockStatus, []);
    expect(result).toContain("View on GitHub");
  });
});

describe("formatRepoNotFound", () => {
  it("shows the name that was tried", () => {
    const result = formatRepoNotFound("typo");
    expect(result).toContain("typo");
  });

  it("explains how to use it", () => {
    const result = formatRepoNotFound("foo");
    expect(result).toContain("short name");
  });
});

describe("formatPrNotFound", () => {
  it("shows repo and number", () => {
    const result = formatPrNotFound("owner/repo", 99);
    expect(result).toContain("owner/repo");
    expect(result).toContain("99");
  });
});

describe("formatApiError", () => {
  it("wraps the message", () => {
    const result = formatApiError("rate limit exceeded");
    expect(result).toContain("rate limit exceeded");
  });
});
