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

import { isFirstContribution, recordFirstContribution } from "./digest.js";
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
