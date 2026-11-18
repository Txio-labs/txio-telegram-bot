import { config } from "../config.js";
import { fetchLatestRelease, fetchRecentRuns } from "./github.js";
import type { Product } from "../products.js";
import { getState, isAnnounced, markAnnounced, updateState } from "../store.js";
import {
  announceKey,
  announceRegistryVersion,
  announceRelease,
  normalizeVersion,
  products,
  type AnnounceDeps,
} from "./announce.js";

// Releases older than this are recorded, not announced (e.g. a long outage).
const MAX_CATCH_UP_AGE_MS = 3 * 24 * 60 * 60 * 1000;
// A workflow release with no matching run in the recent list is announced
// once it is this old, so a release made by hand is not stuck forever.
const UNTRACKED_RELEASE_GRACE_MS = 2 * 60 * 60 * 1000;

// A generic client name, no personal details (crates.io requires a User-Agent).
const USER_AGENT = "txio-telegram-bot (https://github.com/Txio-labs/txio-telegram-bot)";

export async function fetchCrateVersion(name: string, fetchFn: typeof fetch = fetch): Promise<string | null> {
  const res = await fetchFn(`https://crates.io/api/v1/crates/${encodeURIComponent(name)}`, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`crates.io returned ${res.status} for ${name}`);
  const data = (await res.json()) as { crate?: { max_stable_version?: string | null; max_version?: string } };
  return data.crate?.max_stable_version || data.crate?.max_version || null;
}

export async function fetchNpmVersion(name: string, fetchFn: typeof fetch = fetch): Promise<string | null> {
  const res = await fetchFn(`https://registry.npmjs.org/${name.replace("/", "%2f")}`, {
    headers: { Accept: "application/vnd.npm.install-v1+json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`npm returned ${res.status} for ${name}`);
  const data = (await res.json()) as { "dist-tags"?: { latest?: string } };
  return data["dist-tags"]?.latest ?? null;
}

function isSeeded(source: string): boolean {
  return getState().seeded.includes(source);
}

function markSeeded(source: string): Promise<void> {
  return updateState((s) => {
    if (!s.seeded.includes(source)) s.seeded.push(source);
  });
}

/** Catches a GitHub release the webhooks missed (e.g. the bot was asleep). */
async function checkLatestRelease(product: Product, now: number, deps: AnnounceDeps): Promise<void> {
  const fetchFn = deps.fetchFn ?? fetch;
  const release = await fetchLatestRelease(product.repo, fetchFn);
  const source = `release:${product.id}`;
  if (!release) {
    await markSeeded(source);
    return;
  }
  const key = announceKey(product, release.tag_name);
  if (isAnnounced(key)) return;

  const published = Date.parse(release.published_at ?? "");
  // First run against a fresh store, or an old release: record, do not post.
  if (!isSeeded(source) || Number.isNaN(published) || now - published > MAX_CATCH_UP_AGE_MS) {
    await markAnnounced(key);
    await markSeeded(source);
    return;
  }

  if (product.trigger === "workflow") {
    // Only announce once the release workflow for this tag succeeded, so a
    // release whose installers are still uploading is never posted.
    const runs = (await fetchRecentRuns(product.repo, fetchFn)).filter(
      (r) => r.name === product.workflow && r.head_branch === release.tag_name,
    );
    const succeeded = runs.some((r) => r.status === "completed" && r.conclusion === "success");
    const untracked = runs.length === 0 && now - published > UNTRACKED_RELEASE_GRACE_MS;
    if (!succeeded && !untracked) return;
  }
  await announceRelease(product, release.tag_name, "catch-up poll", deps);
}

async function checkRegistry(
  product: Product,
  source: string,
  fetchVersion: () => Promise<string | null>,
  deps: AnnounceDeps,
): Promise<void> {
  const version = await fetchVersion();
  if (!version) return;
  const previous = getState().registryVersions[source];
  if (previous === version) return;
  await updateState((s) => void (s.registryVersions[source] = version));
  if (!previous) {
    // First time this source is seen: it is the baseline, not news.
    await markAnnounced(announceKey(product, version));
    return;
  }
  await announceRegistryVersion(product, normalizeVersion(version), `${source} poll`, deps);
}

/** One pass over every product. Errors are logged per product, never thrown. */
export async function pollReleases(deps: AnnounceDeps = {}, now = Date.now()): Promise<void> {
  if (!config.announce) return;
  const fetchFn = deps.fetchFn ?? fetch;
  for (const product of products()) {
    const checks: Array<[string, () => Promise<void>]> = [];
    if (product.trigger !== "deploy") {
      checks.push([`release:${product.id}`, () => checkLatestRelease(product, now, deps)]);
    }
    if (product.crate) {
      const crate = product.crate;
      checks.push([`crate:${crate}`, () => checkRegistry(product, `crate:${crate}`, () => fetchCrateVersion(crate, fetchFn), deps)]);
    }
    if (product.npm) {
      const npm = product.npm;
      checks.push([`npm:${npm}`, () => checkRegistry(product, `npm:${npm}`, () => fetchNpmVersion(npm, fetchFn), deps)]);
    }
    for (const [name, check] of checks) {
      try {
        await check();
      } catch (error) {
        console.warn(`[poll] ${name} failed:`, error);
      }
    }
  }
}
