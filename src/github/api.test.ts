import { afterEach, describe, expect, it, vi } from "vitest";

// Commands pull in config, which validates required env at import time —
// set them before any module loads (same pattern as config.test.ts).
vi.hoisted(() => {
  process.env.TELEGRAM_BOT_TOKEN = "fake:token";
  process.env.TELEGRAM_CHAT_ID = "-1000000";
  process.env.TELEGRAM_WEBHOOK_SECRET = "fake-webhook-secret";
  process.env.GITHUB_WEBHOOK_SECRET = "fake-github-secret";
  process.env.PUBLIC_URL = "https://example.com";
});
import {
  GitHubApiError,
  getRepoStats,
  lastPageFromLinkHeader,
  listOpenIssuesByLabel,
} from "./api.js";

function fetchOnce(body: unknown, init?: { link?: string; status?: number }) {
  const res = {
    ok: (init?.status ?? 200) < 400,
    status: init?.status ?? 200,
    statusText: "OK",
    json: async () => body,
    headers: new Headers(init?.link ? { link: init.link } : {}),
  } as unknown as Response;
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(res);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("listOpenIssuesByLabel (#43)", () => {
  it("filters pull requests out of the issues feed", async () => {
    const spy = fetchOnce([
      { number: 1, title: "real issue", html_url: "https://x/1" },
      { number: 2, title: "a PR", html_url: "https://x/2", pull_request: { url: "https://x/pr/2" } },
    ]);
    const issues = await listOpenIssuesByLabel("txio-labs/txio-cli", "good-first-issue");
    expect(issues).toEqual([{ number: 1, title: "real issue", html_url: "https://x/1" }]);
    const called = spy.mock.calls[0]?.[0] as string;
    expect(called).toContain("labels=good-first-issue");
    expect(called).toContain("state=open");
  });

  it("caps the returned list length", async () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      number: i + 1,
      title: `issue ${i}`,
      html_url: `https://x/${i}`,
    }));
    fetchOnce(many);
    const issues = await listOpenIssuesByLabel("txio-labs/txio-cli", "help-wanted", 8);
    expect(issues.length).toBe(8);
  });

  it("raises GitHubApiError on HTTP failure", async () => {
    fetchOnce({ message: "Not Found" }, { status: 404 });
    await expect(listOpenIssuesByLabel("txio-labs/nope", "good-first-issue")).rejects.toBeInstanceOf(
      GitHubApiError,
    );
  });
});

describe("getRepoStats (#44)", () => {
  it("aggregates repo, PR, and contributor counts", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        const url = String(input);
        if (url.endsWith("/repos/txio-labs/txio-cli")) {
          return { ok: true, status: 200, statusText: "OK", json: async () => ({ open_issues_count: 15 }), headers: new Headers() } as unknown as Response;
        }
        if (url.includes("/pulls?")) {
          return { ok: true, status: 200, statusText: "OK", json: async () => [1, 2, 3], headers: new Headers() } as unknown as Response;
        }
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          json: async () => [1],
          headers: new Headers({ link: '<https://x/contributors?per_page=1&anon=true&page=42>; rel="last"' }),
        } as unknown as Response;
      });
    const stats = await getRepoStats("txio-labs/txio-cli");
    expect(stats).toEqual({ openIssues: 12, openPullRequests: 3, contributors: "42+" });
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it("reports a 0-contributor repo without a Link header", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/contributors")) {
        return { ok: true, status: 200, statusText: "OK", json: async () => [], headers: new Headers() } as unknown as Response;
      }
      if (url.includes("/pulls")) {
        return { ok: true, status: 200, statusText: "OK", json: async () => [], headers: new Headers() } as unknown as Response;
      }
      return { ok: true, status: 200, statusText: "OK", json: async () => ({ open_issues_count: 0 }), headers: new Headers() } as unknown as Response;
    });
    const stats = await getRepoStats("txio-labs/empty");
    expect(stats.contributors).toBe(0);
  });
});

describe("lastPageFromLinkHeader", () => {
  it("extracts the last page number", () => {
    expect(
      lastPageFromLinkHeader('<https://x?page=2>; rel="next", <https://x?page=9>; rel="last"'),
    ).toBe(9);
  });

  it("returns null when there is no Link header", () => {
    expect(lastPageFromLinkHeader(null)).toBeNull();
  });
});
