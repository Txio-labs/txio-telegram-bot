import { describe, it, expect, vi, beforeEach } from "vitest";

vi.hoisted(() => {
  process.env.TELEGRAM_BOT_TOKEN = "fake:token";
  process.env.TELEGRAM_CHAT_ID = "-1000000";
  process.env.TELEGRAM_WEBHOOK_SECRET = "fake-webhook-secret";
  process.env.GITHUB_WEBHOOK_SECRET = "fake-github-secret";
  process.env.PUBLIC_URL = "https://example.com";
  process.env.ANNOUNCE_CHAT_ID = "-1009999";
  process.env.TOPIC_THREAD_ANNOUNCEMENTS = "42";
  process.env.ANNOUNCE_TOKEN = "s3cret";
  process.env.ANNOUNCE_PIN = "true";
});

import {
  announceRegistryVersion,
  announceRelease,
  announceWebDeploy,
  changelogFromCommits,
  downloadButtons,
  formatReleaseAnnouncement,
  productForRepo,
  resolveTagForRun,
  sendToSubscribers,
  type GitHubRelease,
} from "./announce.js";
import { createAnnounceReleaseHandler } from "./endpoint.js";
import { pollReleases } from "./poller.js";
import { getState, isAnnounced, resetStoreForTests, updateState } from "../store.js";
import type { Product } from "../products.js";

const REPO = "txio-labs/txio-desktop";
const DL = `https://github.com/Txio-labs/txio-desktop/releases/download/v1.1.0`;
const desktop = productForRepo(REPO) as Product;
const cli = productForRepo("txio-labs/txio-cli") as Product;
const web = productForRepo("txio-labs/txio") as Product;

function release(overrides: Partial<GitHubRelease> = {}): GitHubRelease {
  return {
    tag_name: "v1.1.0",
    name: "Txio v1.1.0",
    html_url: `https://github.com/Txio-labs/txio-desktop/releases/tag/v1.1.0`,
    draft: false,
    prerelease: false,
    published_at: "2026-11-18T10:00:00Z",
    assets: [
      { name: "Txio_1.1.0_aarch64.dmg", browser_download_url: `${DL}/Txio_1.1.0_aarch64.dmg` },
      { name: "Txio_1.1.0_x64.dmg", browser_download_url: `${DL}/Txio_1.1.0_x64.dmg` },
      { name: "Txio_1.1.0_x64-setup.exe", browser_download_url: `${DL}/Txio_1.1.0_x64-setup.exe` },
      { name: "Txio_1.1.0_x64_en-US.msi", browser_download_url: `${DL}/Txio_1.1.0_x64_en-US.msi` },
      { name: "Txio_1.1.0_amd64.deb", browser_download_url: `${DL}/Txio_1.1.0_amd64.deb` },
      { name: "Txio_1.1.0_amd64.AppImage", browser_download_url: `${DL}/Txio_1.1.0_amd64.AppImage` },
      { name: "Txio-1.1.0-1.x86_64.rpm", browser_download_url: `${DL}/Txio-1.1.0-1.x86_64.rpm` },
      { name: "latest.json", browser_download_url: `${DL}/latest.json` },
    ],
    ...overrides,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

// Routes request URLs (GitHub paths, or full URLs for other hosts) to canned responses.
function fakeFetch(routes: Record<string, () => Response>): typeof fetch {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    const route = routes[url.replace("https://api.github.com", "")] ?? routes[url];
    return route ? route() : json({ message: "Not Found" }, 404);
  }) as unknown as typeof fetch;
}

const happyRoutes = {
  [`/repos/${REPO}/releases/tags/v1.1.0`]: () => json(release()),
  [`/repos/${REPO}/releases?per_page=20`]: () =>
    json([release(), release({ tag_name: "v1.0.0", published_at: "2026-11-01T10:00:00Z" })]),
  [`/repos/${REPO}/compare/v1.0.0...v1.1.0`]: () =>
    json({
      commits: [
        { commit: { message: "feat: browser sign-in via txio-desktop:// links" } },
        { commit: { message: "ci(release): build Apple silicon on macos-15" } },
        { commit: { message: "Merge pull request #22 from Txio-labs/feat/x" } },
        { commit: { message: "fix(rpc): retry Sui GraphQL on 429\n\nbody" } },
      ],
    }),
};

const noSleep = { sleep: async () => undefined };

beforeEach(() => resetStoreForTests());

describe("changelogFromCommits", () => {
  it("keeps feat/fix/perf subjects and drops the rest", () => {
    expect(
      changelogFromCommits([
        "feat: add Stellar",
        "fix(ui): wallet menu overflow",
        "perf: faster boot",
        "chore: bump deps",
        "Merge pull request #1 from a/b",
        "style: cargo fmt",
      ]),
    ).toEqual(["New: Add Stellar", "Fixed: Wallet menu overflow", "Faster: Faster boot"]);
  });

  it("removes duplicate subjects", () => {
    expect(changelogFromCommits(["fix: crash", "fix: crash"])).toEqual(["Fixed: Crash"]);
  });
});

describe("downloadButtons", () => {
  it("adds one button per platform, two per row, then the links row", () => {
    const keyboard = downloadButtons(release(), "https://txio-labs.github.io/txio-desktop/");
    const labels = keyboard.inline_keyboard.map((row) => row.map((b) => b.text));
    expect(labels).toEqual([
      ["macOS (Apple silicon)", "macOS (Intel)"],
      ["Windows", "Linux .deb"],
      ["Linux AppImage", "Linux .rpm"],
      ["Download page", "Release notes"],
    ]);
    expect(keyboard.inline_keyboard[1][0].url).toBe(`${DL}/Txio_1.1.0_x64-setup.exe`);
  });

  it("only links the release notes when there are no installers", () => {
    const keyboard = downloadButtons(release({ assets: [] }), undefined);
    expect(keyboard.inline_keyboard).toEqual([[{ text: "Release notes", url: release().html_url }]]);
  });
});

describe("formatReleaseAnnouncement", () => {
  it("includes the product, changelog and update hint, HTML-escaped", () => {
    const text = formatReleaseAnnouncement(desktop, release(), ["New: <script> & more"]);
    expect(text).toContain("<b>Txio Desktop v1.1.0 is out</b>");
    expect(text).toContain("• New: &lt;script&gt; &amp; more");
    expect(text).toContain("updates itself");
  });

  it("shows the install command for CLI-style products", () => {
    const text = formatReleaseAnnouncement(cli, release({ assets: [] }), []);
    expect(text).toContain("<code>cargo install txio</code>");
    expect(text).not.toContain("updates itself");
  });

  it("caps the changelog and reports the rest", () => {
    const lines = Array.from({ length: 20 }, (_, i) => `New: thing ${i}`);
    expect(formatReleaseAnnouncement(desktop, release(), lines)).toContain("…and 8 more");
  });

  it("drops the changelog when the message would be too long", () => {
    const lines = Array.from({ length: 12 }, () => `New: ${"x".repeat(400)}`);
    const text = formatReleaseAnnouncement(desktop, release(), lines);
    expect(text).not.toContain("What's new");
    expect(text.length).toBeLessThan(3800);
  });
});

describe("announceRelease", () => {
  it("posts once to the announcements chat/topic, pins it and persists it", async () => {
    const send = vi.fn().mockResolvedValue(77);
    const pin = vi.fn().mockResolvedValue(undefined);
    const fetchFn = fakeFetch(happyRoutes);

    const first = await announceRelease(desktop, "v1.1.0", "test", { fetchFn, send, pin, ...noSleep });
    const second = await announceRelease(desktop, "v1.1.0", "test", { fetchFn, send, pin, ...noSleep });

    expect(first).toEqual({ status: "announced", messageId: 77, subscribers: 0 });
    expect(second).toEqual({ status: "duplicate" });
    expect(send).toHaveBeenCalledOnce();
    const [chatId, text, threadId] = send.mock.calls[0];
    expect(chatId).toBe("-1009999");
    expect(threadId).toBe(42);
    expect(text).toContain("New: Browser sign-in via txio-desktop:// links");
    expect(text).toContain("Fixed: Retry Sui GraphQL on 429");
    expect(text).not.toContain("macos-15");
    expect(pin).toHaveBeenCalledWith("-1009999", 77);
    expect(isAnnounced("desktop@1.1.0")).toBe(true);
  });

  it("posts once when both triggers arrive at the same time", async () => {
    const send = vi.fn().mockResolvedValue(1);
    const deps = { fetchFn: fakeFetch(happyRoutes), send, pin: vi.fn(), ...noSleep };
    const results = await Promise.all([
      announceRelease(desktop, "v1.1.0", "a", deps),
      announceRelease(desktop, "v1.1.0", "b", deps),
    ]);
    expect(send).toHaveBeenCalledOnce();
    expect(results.map((r) => r.status).sort()).toEqual(["announced", "duplicate"]);
  });

  it("DMs subscribers and drops chats that blocked the bot", async () => {
    await updateState((s) => {
      s.subscriptions = { "111": ["desktop"], "222": ["desktop", "cli"], "333": ["cli"] };
    });
    const send = vi.fn(async (chatId: string | number) => {
      if (chatId === "222") throw Object.assign(new Error("Forbidden"), { error_code: 403 });
      return 1;
    });
    const result = await announceRelease(desktop, "v1.1.0", "test", {
      fetchFn: fakeFetch(happyRoutes),
      send,
      pin: vi.fn(),
      ...noSleep,
    });
    expect(result).toMatchObject({ status: "announced", subscribers: 1 });
    expect(send.mock.calls.map((c) => c[0])).toEqual(["-1009999", "111", "222"]);
    expect(getState().subscriptions).toEqual({ "111": ["desktop"], "333": ["cli"] });
  });

  it("still announces when pinning fails", async () => {
    const result = await announceRelease(desktop, "v1.1.0", "test", {
      fetchFn: fakeFetch(happyRoutes),
      send: vi.fn().mockResolvedValue(5),
      pin: vi.fn().mockRejectedValue(new Error("not enough rights")),
      ...noSleep,
    });
    expect(result.status).toBe("announced");
  });

  it("announces without a changelog when the compare call fails", async () => {
    const send = vi.fn().mockResolvedValue(1);
    await announceRelease(desktop, "v1.1.0", "test", {
      fetchFn: fakeFetch({ [`/repos/${REPO}/releases/tags/v1.1.0`]: () => json(release()) }),
      send,
      pin: vi.fn(),
      ...noSleep,
    });
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0][1]).not.toContain("What's new");
  });

  it("skips prereleases", async () => {
    const send = vi.fn();
    const result = await announceRelease(desktop, "v1.1.0", "test", {
      fetchFn: fakeFetch({ [`/repos/${REPO}/releases/tags/v1.1.0`]: () => json(release({ prerelease: true })) }),
      send,
    });
    expect(result.status).toBe("skipped");
    expect(send).not.toHaveBeenCalled();
  });

  it("throws when the release does not exist, and allows a retry", async () => {
    const send = vi.fn().mockResolvedValue(1);
    await expect(announceRelease(desktop, "v1.1.0", "test", { fetchFn: fakeFetch({}), send })).rejects.toThrow(
      "No release found",
    );
    const retry = await announceRelease(desktop, "v1.1.0", "test", {
      fetchFn: fakeFetch(happyRoutes),
      send,
      pin: vi.fn(),
      ...noSleep,
    });
    expect(retry.status).toBe("announced");
  });
});

describe("announceRegistryVersion", () => {
  it("posts a short note when there is no GitHub release for the version", async () => {
    const send = vi.fn().mockResolvedValue(3);
    const result = await announceRegistryVersion(cli, "0.1.3", "test", {
      fetchFn: fakeFetch({}),
      send,
      pin: vi.fn(),
      ...noSleep,
    });
    expect(result.status).toBe("announced");
    expect(send.mock.calls[0][1]).toContain("<b>Txio CLI 0.1.3 is out</b>");
    expect(send.mock.calls[0][1]).toContain("cargo install txio");
    expect(isAnnounced("cli@0.1.3")).toBe(true);
  });

  it("does not repeat a version already announced from its GitHub release", async () => {
    await updateState((s) => void s.announced.push("cli@0.1.3"));
    const send = vi.fn();
    expect((await announceRegistryVersion(cli, "0.1.3", "test", { send })).status).toBe("duplicate");
    expect(send).not.toHaveBeenCalled();
  });
});

describe("announceWebDeploy", () => {
  const compare = (commits: string[]) => () => json({ commits: commits.map((message) => ({ commit: { message } })) });

  it("records the first deploy without posting", async () => {
    const send = vi.fn();
    const result = await announceWebDeploy(web, "aaa111", "test", { send });
    expect(result.status).toBe("skipped");
    expect(getState().webDeploySha.web).toBe("aaa111");
    expect(send).not.toHaveBeenCalled();
  });

  it("posts the user-facing changes since the last deploy", async () => {
    await updateState((s) => void (s.webDeploySha.web = "aaa111"));
    const send = vi.fn().mockResolvedValue(8);
    const result = await announceWebDeploy(web, "bbb222", "test", {
      fetchFn: fakeFetch({ "/repos/txio-labs/txio/compare/aaa111...bbb222": compare(["feat: Aptos simulation"]) }),
      send,
      pin: vi.fn(),
      ...noSleep,
    });
    expect(result.status).toBe("announced");
    expect(send.mock.calls[0][1]).toContain("Txio Web updated");
    expect(send.mock.calls[0][1]).toContain("New: Aptos simulation");
    expect(getState().webDeploySha.web).toBe("bbb222");
  });

  it("stays quiet when only internal changes shipped", async () => {
    await updateState((s) => void (s.webDeploySha.web = "aaa111"));
    const send = vi.fn();
    const result = await announceWebDeploy(web, "ccc333", "test", {
      fetchFn: fakeFetch({ "/repos/txio-labs/txio/compare/aaa111...ccc333": compare(["chore: deps", "ci: cache"]) }),
      send,
    });
    expect(result).toEqual({ status: "skipped", reason: "no user-facing changes" });
    expect(send).not.toHaveBeenCalled();
  });
});

describe("sendToSubscribers", () => {
  it("keeps chats after a temporary error", async () => {
    await updateState((s) => void (s.subscriptions = { "111": ["cli"] }));
    const send = vi.fn().mockRejectedValue(Object.assign(new Error("Too Many Requests"), { error_code: 429 }));
    expect(await sendToSubscribers("cli", "hi", { inline_keyboard: [] }, { send, ...noSleep })).toBe(0);
    expect(getState().subscriptions).toEqual({ "111": ["cli"] });
  });
});

describe("resolveTagForRun", () => {
  it("uses head_branch when it names a release", async () => {
    expect(await resolveTagForRun(REPO, { head_branch: "v1.1.0" }, fakeFetch(happyRoutes))).toBe("v1.1.0");
  });

  it("falls back to the latest release published after the run started", async () => {
    const fetchFn = fakeFetch({ [`/repos/${REPO}/releases/latest`]: () => json(release()) });
    expect(
      await resolveTagForRun(REPO, { head_branch: "main", run_started_at: "2026-11-18T09:40:00Z" }, fetchFn),
    ).toBe("v1.1.0");
    expect(
      await resolveTagForRun(REPO, { head_branch: "main", run_started_at: "2026-11-18T11:00:00Z" }, fetchFn),
    ).toBeNull();
  });
});

describe("pollReleases", () => {
  const NOW = Date.parse("2026-11-18T12:00:00Z");
  const run = (conclusion: string | null, status = "completed") => ({
    id: 1, name: "Release", head_branch: "v1.1.0", status, conclusion, html_url: "https://x",
  });
  const pollRoutes = (runs: unknown[]) => ({
    ...happyRoutes,
    [`/repos/${REPO}/releases/latest`]: () => json(release()),
    [`/repos/${REPO}/actions/runs?per_page=30`]: () => json({ workflow_runs: runs }),
    "https://crates.io/api/v1/crates/txio": () => json({ crate: { max_stable_version: "0.1.2" } }),
  });

  it("records what exists on the first poll without posting", async () => {
    const send = vi.fn();
    await pollReleases({ fetchFn: fakeFetch(pollRoutes([run("success")])), send }, NOW);
    expect(send).not.toHaveBeenCalled();
    expect(isAnnounced("desktop@1.1.0")).toBe(true);
    expect(getState().registryVersions["crate:txio"]).toBe("0.1.2");
  });

  it("catches a missed desktop release once its workflow succeeded", async () => {
    await updateState((s) => void (s.seeded = ["release:desktop"]));
    const send = vi.fn().mockResolvedValue(1);
    const deps = { send, pin: vi.fn(), ...noSleep };

    await pollReleases({ ...deps, fetchFn: fakeFetch(pollRoutes([run(null, "in_progress")])) }, NOW);
    expect(send).not.toHaveBeenCalled();

    await pollReleases({ ...deps, fetchFn: fakeFetch(pollRoutes([run("success")])) }, NOW);
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0][1]).toContain("Txio Desktop v1.1.0 is out");
  });

  it("announces a new crates.io version", async () => {
    await updateState((s) => {
      s.seeded = ["release:desktop"];
      s.announced = ["desktop@1.1.0"];
      s.registryVersions = { "crate:txio": "0.1.2" };
    });
    const send = vi.fn().mockResolvedValue(1);
    const routes = {
      ...pollRoutes([]),
      "https://crates.io/api/v1/crates/txio": () => json({ crate: { max_stable_version: "0.1.3" } }),
    };
    await pollReleases({ fetchFn: fakeFetch(routes), send, pin: vi.fn(), ...noSleep }, NOW);
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0][1]).toContain("Txio CLI 0.1.3 is out");
  });
});

describe("POST /announce/release", () => {
  function call(headers: Record<string, string>, body: unknown, deps = {}) {
    const handler = createAnnounceReleaseHandler(deps);
    const res = { statusCode: 0, body: undefined as unknown } as any;
    res.status = (code: number) => ((res.statusCode = code), res);
    res.json = (payload: unknown) => ((res.body = payload), res);
    const req = { body, get: (name: string) => headers[name.toLowerCase()] } as any;
    return handler(req, res).then(() => res);
  }

  it("rejects a missing or wrong token", async () => {
    expect((await call({}, { repo: REPO, tag: "v1.1.0" })).statusCode).toBe(401);
    expect((await call({ authorization: "Bearer nope" }, { repo: REPO, tag: "v1.1.0" })).statusCode).toBe(401);
  });

  it("rejects a bad body, unknown repos and deploy-only products", async () => {
    const auth = { authorization: "Bearer s3cret" };
    expect((await call(auth, { repo: "x", tag: "v1" })).statusCode).toBe(400);
    expect((await call(auth, { repo: "a/b", tag: "v1" })).statusCode).toBe(403);
    expect((await call(auth, { repo: "Txio-labs/txio", tag: "v1" })).statusCode).toBe(403);
  });

  it("announces and returns 200 (repo matching is case-insensitive)", async () => {
    const send = vi.fn().mockResolvedValue(9);
    const res = await call(
      { authorization: "Bearer s3cret" },
      { repo: "Txio-labs/txio-desktop", tag: "v1.1.0" },
      { fetchFn: fakeFetch(happyRoutes), send, pin: vi.fn(), ...noSleep },
    );
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ status: "announced", messageId: 9, subscribers: 0 });
  });

  it("returns 502 so the workflow retries when GitHub has no release yet", async () => {
    const res = await call(
      { authorization: "Bearer s3cret" },
      { repo: REPO, tag: "v1.1.0" },
      { fetchFn: fakeFetch({}), send: vi.fn() },
    );
    expect(res.statusCode).toBe(502);
  });
});
