import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.hoisted(() => {
  process.env.TELEGRAM_BOT_TOKEN = "fake:token";
  process.env.TELEGRAM_CHAT_ID = "-1000000";
  process.env.TELEGRAM_WEBHOOK_SECRET = "fake-webhook-secret";
  process.env.GITHUB_WEBHOOK_SECRET = "fake-github-secret";
  process.env.PUBLIC_URL = "https://example.com";
});

const { mockSendMessage } = vi.hoisted(() => ({ mockSendMessage: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./telegram/client.js", () => ({ sendMessage: mockSendMessage, bot: {} }));

import { formatWeeklyDigest, isFirstContribution, recordFirstContribution, runWeeklyDigest } from "./digest.js";
import { parseProducts, DEFAULT_PRODUCTS } from "./products.js";
import { formatReleaseFailure } from "./releases/failures.js";
import { formatStatus, runStatusChecks, defaultChecks } from "./status.js";
import { FileBackend, getState, initStore, resetStoreForTests, updateState } from "./store.js";
import { parseProductArg, setSubscription } from "./telegram/productCommands.js";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  resetStoreForTests();
  mockSendMessage.mockClear();
});

describe("products", () => {
  it("defaults cover desktop, CLI, SDK and web", () => {
    expect(DEFAULT_PRODUCTS.map((p) => p.id)).toEqual(["desktop", "cli", "sdk", "web"]);
  });

  it("validates a custom product file", () => {
    expect(parseProducts([{ id: "app", name: "App", repo: "Org/App", trigger: "release" }], "f")[0].repo).toBe("org/app");
    expect(() => parseProducts([{ id: "app", name: "App", repo: "o/a", trigger: "workflow" }], "f")).toThrow(
      "workflow is required",
    );
    expect(() => parseProducts([{ id: "Bad Id", name: "x", repo: "o/a", trigger: "release" }], "f")).toThrow("lowercase");
    expect(() => parseProducts({}, "f")).toThrow("JSON array");
  });
});

describe("store", () => {
  it("persists to a file and loads it back", async () => {
    const dir = await mkdtemp(join(tmpdir(), "txio-bot-"));
    try {
      const path = join(dir, "nested", "state.json");
      await initStore(new FileBackend(path));
      await updateState((s) => void s.announced.push("desktop@1.0.0"));
      resetStoreForTests();
      await initStore(new FileBackend(path));
      expect(getState().announced).toEqual(["desktop@1.0.0"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("starts empty when the backend fails to load", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await initStore({ name: "broken", load: async () => { throw new Error("down"); }, save: async () => undefined });
    expect(getState().announced).toEqual([]);
    errors.mockRestore();
  });
});

describe("subscriptions", () => {
  it("parses product names and 'all'", () => {
    expect(parseProductArg("Desktop")).toEqual(["desktop"]);
    expect(parseProductArg("all")).toEqual(["desktop", "cli", "sdk", "web"]);
    expect(parseProductArg("nope")).toBeNull();
  });

  it("adds and removes, deleting empty entries", async () => {
    expect(await setSubscription("5", ["cli", "desktop"], true)).toEqual(["cli", "desktop"]);
    expect(await setSubscription("5", ["cli"], false)).toEqual(["desktop"]);
    await setSubscription("5", ["desktop"], false);
    expect(getState().subscriptions).toEqual({});
  });
});

describe("weekly digest", () => {
  const NOW = Date.parse("2026-11-18T09:00:00Z");
  const pr = (number: number, author: string) => ({
    repo: "txio-labs/txio-desktop",
    number,
    title: `Change ${number}`,
    url: `https://github.com/txio-labs/txio-desktop/pull/${number}`,
    author,
    mergedAt: "2026-11-17T00:00:00Z",
  });

  it("returns null for a quiet week", () => {
    expect(formatWeeklyDigest([{ repo: "a/b", merged: [], releases: [] }], [], NOW)).toBeNull();
  });

  it("lists releases, merged PRs, contributors and first-timers", () => {
    const text = formatWeeklyDigest(
      [
        {
          repo: "txio-labs/txio-desktop",
          merged: [pr(1, "alice"), pr(2, "bob"), pr(3, "alice")],
          releases: [{ tag: "v1.1.0", url: "https://r" }],
        },
      ],
      [{ login: "bob", repo: "txio-labs/txio-desktop", number: 2, url: "https://p/2", at: "2026-11-17T00:00:00Z" }],
      NOW,
    ) as string;
    expect(text).toContain("3 PRs merged by 2 contributors");
    expect(text).toContain("Released");
    expect(text).toContain("alice (2), bob (1)");
    expect(text).toContain("First contributions");
  });

  it("caps the message length", () => {
    const repos = Array.from({ length: 40 }, (_, i) => ({
      repo: `org/repo-${i}`,
      merged: Array.from({ length: 5 }, (_, j) => ({ ...pr(j, `user${j}`), title: "x".repeat(80) })),
      releases: [],
    }));
    expect((formatWeeklyDigest(repos, [], NOW) as string).length).toBeLessThanOrEqual(3800 + 60);
  });

  it("queries each repo and posts one message", async () => {
    const fetchFn = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/pulls")) {
        return json([
          { number: 9, title: "Fix it", html_url: "https://p/9", merged_at: "2026-11-17T00:00:00Z", user: { login: "carol" } },
          { number: 8, title: "Old", html_url: "https://p/8", merged_at: "2026-10-01T00:00:00Z", user: { login: "dan" } },
          { number: 7, title: "Bump", html_url: "https://p/7", merged_at: "2026-11-17T00:00:00Z", user: { login: "dependabot[bot]", type: "Bot" } },
        ]);
      }
      return json([]);
    }) as unknown as typeof fetch;
    expect(await runWeeklyDigest(NOW, fetchFn)).toBe(true);
    expect(mockSendMessage).toHaveBeenCalledOnce();
    const text = mockSendMessage.mock.calls[0][1] as string;
    expect(text).toContain("#9 Fix it");
    expect(text).not.toContain("Old");
    expect(text).not.toContain("Bump");
  });
});

describe("first contributions", () => {
  it("recognizes GitHub's first-time associations", () => {
    expect(isFirstContribution("FIRST_TIME_CONTRIBUTOR")).toBe(true);
    expect(isFirstContribution("FIRST_TIMER")).toBe(true);
    expect(isFirstContribution("CONTRIBUTOR")).toBe(false);
    expect(isFirstContribution(undefined)).toBe(false);
  });

  it("thanks the author once and records them for the digest", async () => {
    const f = { login: "erin", repo: "txio-labs/txio", number: 4, url: "https://p/4", at: "2026-11-17T00:00:00Z" };
    await recordFirstContribution(f, "Add <Stellar>");
    await recordFirstContribution(f, "Add <Stellar>");
    expect(mockSendMessage).toHaveBeenCalledOnce();
    expect(mockSendMessage.mock.calls[0][1]).toContain("Add &lt;Stellar&gt;");
    expect(getState().firstTimers).toHaveLength(1);
  });
});

describe("release failure alert", () => {
  const product = DEFAULT_PRODUCTS[0];
  const run = { id: 1, name: "Release", head_branch: "v1.1.0", status: "completed", conclusion: "failure", html_url: "https://run" };

  it("names the failed jobs and warns about a partial public release", () => {
    const text = formatReleaseFailure(product, run, [{ name: "build (windows-latest)", conclusion: "failure", html_url: "https://job" }], "https://rel");
    expect(text).toContain("Txio Desktop release v1.1.0 failed");
    expect(text).toContain("build (windows-latest)");
    expect(text).toContain("some installers missing");
  });

  it("says nothing was published when there is no release", () => {
    expect(formatReleaseFailure(product, run, [], null)).toContain("Nothing was published");
  });
});

describe("status", () => {
  it("covers Txio services and every supported chain family", () => {
    expect(defaultChecks().map((c) => c.name)).toEqual([
      "Txio API", "Txio Web", "Aptos", "Ethereum", "Solana", "Stellar", "Sui",
    ]);
  });

  it("reports failures without throwing", async () => {
    const results = await runStatusChecks([
      { name: "Up", run: async () => "block 1" },
      { name: "Down", run: async () => { throw new Error("HTTP 503"); } },
    ]);
    expect(results.map((r) => [r.name, r.ok, r.detail])).toEqual([
      ["Up", true, "block 1"],
      ["Down", false, "HTTP 503"],
    ]);
    const text = formatStatus(results, new Date("2026-11-18T09:05:00Z"));
    expect(text).toContain("1 of 2 checks failing");
    expect(text).toContain("09:05 UTC");
  });
});
