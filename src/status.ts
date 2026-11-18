import { config } from "./config.js";
import { escapeHtml } from "./utils/html.js";

/**
 * Health checks behind /status: Txio's own services, then one public mainnet
 * endpoint per supported chain family, in alphabetical order. No chain is
 * treated as primary.
 */
export type StatusCheck = {
  name: string;
  run: (fetchFn: typeof fetch) => Promise<string | undefined>;
};

export type StatusResult = { name: string; ok: boolean; ms: number; detail?: string };

const TIMEOUT_MS = 8_000;

async function postJson(fetchFn: typeof fetch, url: string, body: unknown): Promise<any> {
  const res = await fetchFn(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data?.error) throw new Error(data.error.message ?? "RPC error");
  if (data?.errors?.length) throw new Error(data.errors[0].message ?? "GraphQL error");
  return data;
}

// Txio's own services may be waking from a cold start; give them longer.
const SERVICE_TIMEOUT_MS = 25_000;

async function getOk(fetchFn: typeof fetch, url: string, timeoutMs = TIMEOUT_MS): Promise<Response> {
  const res = await fetchFn(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}

const n = (value: unknown) => Number(value).toLocaleString("en-US");

export function defaultChecks(): StatusCheck[] {
  return [
    { name: "Txio API", run: async (f) => void (await getOk(f, config.status.apiUrl, SERVICE_TIMEOUT_MS)) },
    { name: "Txio Web", run: async (f) => void (await getOk(f, config.status.webUrl, SERVICE_TIMEOUT_MS)) },
    {
      name: "Aptos",
      run: async (f) => {
        const data = (await (await getOk(f, "https://fullnode.mainnet.aptoslabs.com/v1")).json()) as { ledger_version?: string };
        return `ledger ${n(data.ledger_version)}`;
      },
    },
    {
      name: "Ethereum",
      run: async (f) => {
        const data = await postJson(f, "https://ethereum-rpc.publicnode.com", {
          jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [],
        });
        return `block ${n(parseInt(data.result, 16))}`;
      },
    },
    {
      name: "Solana",
      run: async (f) => {
        const data = await postJson(f, "https://solana-rpc.publicnode.com", {
          jsonrpc: "2.0", id: 1, method: "getSlot", params: [],
        });
        return `slot ${n(data.result)}`;
      },
    },
    {
      name: "Stellar",
      run: async (f) => {
        const data = (await (await getOk(f, "https://horizon.stellar.org")).json()) as { history_latest_ledger?: number };
        return `ledger ${n(data.history_latest_ledger)}`;
      },
    },
    {
      // Public Sui fullnodes no longer serve JSON-RPC; GraphQL is the supported API.
      name: "Sui",
      run: async (f) => {
        const data = await postJson(f, "https://graphql.mainnet.sui.io/graphql", {
          query: "{ checkpoint { sequenceNumber } }",
        });
        return `checkpoint ${n(data.data.checkpoint.sequenceNumber)}`;
      },
    },
  ];
}

export async function runStatusChecks(
  checks: StatusCheck[] = defaultChecks(),
  fetchFn: typeof fetch = fetch,
): Promise<StatusResult[]> {
  return Promise.all(
    checks.map(async (check) => {
      const started = Date.now();
      try {
        const detail = await check.run(fetchFn);
        return { name: check.name, ok: true, ms: Date.now() - started, detail };
      } catch (error) {
        const err = error as Error;
        const detail = err.name === "TimeoutError" || err.name === "AbortError" ? "timed out" : err.message;
        return { name: check.name, ok: false, ms: Date.now() - started, detail };
      }
    }),
  );
}

export function formatStatus(results: StatusResult[], checkedAt: Date): string {
  const down = results.filter((r) => !r.ok).length;
  const header = down === 0 ? "🟢 <b>All systems operational</b>" : `🔴 <b>${down} of ${results.length} checks failing</b>`;
  const lines = results.map((r) => {
    const icon = r.ok ? "🟢" : "🔴";
    const detail = r.detail ? ` · ${escapeHtml(r.detail)}` : "";
    return `${icon} ${escapeHtml(r.name)}${detail} · ${r.ms} ms`;
  });
  const time = checkedAt.toISOString().slice(11, 16);
  return `${header}\n\n${lines.join("\n")}\n\n<i>Checked ${time} UTC. Chains use public mainnet nodes.</i>`;
}

// One shared result for 30 s, so many /status calls do not hammer the nodes.
const CACHE_MS = 30_000;
let cached: { at: number; text: string } | null = null;
let pending: Promise<string> | null = null;

export async function getStatusText(now = Date.now()): Promise<string> {
  if (cached && now - cached.at < CACHE_MS) return cached.text;
  if (!pending) {
    pending = runStatusChecks()
      .then((results) => {
        const text = formatStatus(results, new Date());
        cached = { at: Date.now(), text };
        return text;
      })
      .finally(() => {
        pending = null;
      });
  }
  return pending;
}
