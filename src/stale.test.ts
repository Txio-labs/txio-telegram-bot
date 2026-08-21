import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  isStale,
  daysSince,
  fetchOpenItems,
  collectStaleItems,
  formatStaleItemLine,
  formatStaleDigest,
  STALE_DIGEST_MAX_LENGTH,
} from "./stale.js";

const NOW = new Date("2026-08-20T12:00:00Z");

function item(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    number: 42,
    title: "Slow PR",
    html_url: "https://github.com/txio-labs/txio-backend/pull/42",
    updated_at: "2026-08-01T12:00:00Z",
    user: { login: "alice" },
    ...overrides,
  };
}

describe("isStale", () => {
  it("returns true when updated_at is older than the threshold", () => {
    expect(isStale("2026-08-01T12:00:00Z", NOW, 7)).toBe(true);
  });

  it("returns false when updated_at is within the threshold", () => {
    expect(isStale("2026-08-15T12:00:00Z", NOW, 7)).toBe(false);
  });

  it("treats exactly-at-threshold as stale", () => {
    expect(isStale("2026-08-13T12:00:00Z", NOW, 7)).toBe(true);
  });

  it("returns false for an invalid date", () => {
    expect(isStale("not-a-date", NOW, 7)).toBe(false);
  });

  it("returns false for future dates", () => {
    expect(isStale("2026-09-01T12:00:00Z", NOW, 7)).toBe(false);
  });
});

describe("daysSince", () => {
  it("counts full days since the last activity", () => {
    expect(daysSince("2026-08-10T00:00:00Z", NOW)).toBe(10);
  });

  it("never returns negative values", () => {
    expect(daysSince("2026-09-01T00:00:00Z", NOW)).toBe(0);
  });
});

describe("fetchOpenItems", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("queries the open issues endpoint and marks pull requests", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [item({ pull_request: { url: "x" } }), item({ number: 7, title: "Bug" })],
    });

    const result = await fetchOpenItems("txio-labs/txio-backend", undefined, mockFetch);

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.github.com/repos/txio-labs/txio-backend/issues?state=open&per_page=100",
      expect.objectContaining({
        headers: expect.objectContaining({ Accept: "application/vnd.github+json" }),
      }),
    );
    expect(result[0].isPullRequest).toBe(true);
    expect(result[1].isPullRequest).toBe(false);
  });

  it("sends an Authorization header when a token is provided", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [] });

    await fetchOpenItems("txio-labs/txio-backend", "secret-token", mockFetch);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer secret-token" }),
      }),
    );
  });

  it("throws when the API returns an error status", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 403, statusText: "Forbidden" });

    await expect(fetchOpenItems("txio-labs/txio-backend", undefined, mockFetch)).rejects.toThrow(
      /403/,
    );
  });
});

describe("collectStaleItems", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("keeps only items past the threshold", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        item({ updated_at: "2026-08-01T12:00:00Z" }),
        item({ number: 7, updated_at: "2026-08-19T12:00:00Z" }),
      ],
    });

    const result = await collectStaleItems(["txio-labs/txio-backend"], {
      now: NOW,
      thresholdDays: 7,
      fetchFn: mockFetch,
    });

    expect(result).toHaveLength(1);
    expect(result[0].number).toBe(42);
  });

  it("completes cleanly for repos with no open items", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [] });

    const result = await collectStaleItems(["txio-labs/txio-backend"], {
      now: NOW,
      thresholdDays: 7,
      fetchFn: mockFetch,
    });

    expect(result).toEqual([]);
  });

  it("logs and skips a repo when its API call fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockFetch
      .mockRejectedValueOnce(new Error("rate limited"))
      .mockResolvedValueOnce({ ok: true, json: async () => [item()] });

    const result = await collectStaleItems(
      ["txio-labs/txio-backend", "txio-labs/txio-cli"],
      { now: NOW, thresholdDays: 7, fetchFn: mockFetch },
    );

    expect(result).toHaveLength(1);
    expect(errorSpy).toHaveBeenCalledWith(
      "Stale check failed for txio-labs/txio-backend:",
      "rate limited",
    );
    errorSpy.mockRestore();
  });
});

describe("formatStaleItemLine", () => {
  it("formats a stale PR with icon, days and author", () => {
    const text = formatStaleItemLine(
      {
        repoFullName: "txio-labs/txio-backend",
        number: 42,
        title: "Slow PR",
        htmlUrl: "https://github.com/txio-labs/txio-backend/pull/42",
        updatedAt: "2026-08-10T12:00:00Z",
        isPullRequest: true,
        author: "alice",
      },
      NOW,
    );

    expect(text).toContain("🔀");
    expect(text).toContain('<a href="https://github.com/txio-labs/txio-backend/pull/42">');
    expect(text).toContain("#42 Slow PR");
    expect(text).toContain("no activity for 10 days");
    expect(text).toContain("by alice");
  });

  it("escapes HTML in titles and authors", () => {
    const text = formatStaleItemLine(
      {
        repoFullName: "txio-labs/txio-backend",
        number: 1,
        title: "A <b>bold</b> & tricky title",
        htmlUrl: "https://github.com/x",
        updatedAt: "2026-08-01T12:00:00Z",
        isPullRequest: false,
        author: "a&b",
      },
      NOW,
    );

    expect(text).toContain("&lt;b&gt;bold&lt;/b&gt;");
    expect(text).toContain("a&amp;b");
  });
});

describe("formatStaleDigest", () => {
  function staleItem(
    repoFullName: string,
    number: number,
    title: string,
    isPullRequest = false,
  ) {
    return {
      repoFullName,
      number,
      title,
      htmlUrl: `https://github.com/${repoFullName}/issues/${number}`,
      updatedAt: "2026-08-01T12:00:00Z",
      isPullRequest,
      author: "alice",
    };
  }

  it("renders one digest grouping items by repo", () => {
    const text = formatStaleDigest(
      [
        staleItem("txio-labs/txio-backend", 42, "Slow PR", true),
        staleItem("txio-labs/txio-cli", 7, "Old issue"),
      ],
      NOW,
      7,
    );

    expect(text).toContain("no activity for 7 days or more");
    expect(text).toContain("<b>txio-labs/txio-backend</b>");
    expect(text).toContain("<b>txio-labs/txio-cli</b>");
    expect(text).toContain("#42 Slow PR");
    expect(text).toContain("#7 Old issue");
  });

  it("returns the header only for an empty item list", () => {
    const text = formatStaleDigest([], NOW, 7);
    expect(text).toContain("no activity for 7 days or more");
  });

  it("caps the digest length and reports dropped items", () => {
    const many = Array.from({ length: 300 }, (_, i) =>
      staleItem("txio-labs/txio-backend", i, `Issue number ${i}`),
    );

    const text = formatStaleDigest(many, NOW, 7);

    expect(text.length).toBeLessThanOrEqual(STALE_DIGEST_MAX_LENGTH);
    expect(text).toMatch(/…and \d+ more stale items not shown/);
    expect(text).toContain("Issue number 0");
  });
});