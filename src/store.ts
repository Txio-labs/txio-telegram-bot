import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Bot state that must survive restarts: which releases were announced, who
 * subscribed to DMs, the last web deploy per product, and so on. Small enough
 * to load and save as one JSON document.
 */
export type FirstTimer = { login: string; repo: string; number: number; url: string; at: string };

export type BotState = {
  /** `<productId>@<version>` keys already announced. */
  announced: string[];
  /** Poll sources whose current value was recorded without announcing. */
  seeded: string[];
  /** Last seen registry version per source, e.g. `crate:txio`. */
  registryVersions: Record<string, string>;
  /** Last announced web deploy commit per product id. */
  webDeploySha: Record<string, string>;
  /** Telegram chat id -> subscribed product ids. */
  subscriptions: Record<string, string[]>;
  /** First-time contributors whose PR was merged, for the weekly digest. */
  firstTimers: FirstTimer[];
};

export function emptyState(): BotState {
  return {
    announced: [],
    seeded: [],
    registryVersions: {},
    webDeploySha: {},
    subscriptions: {},
    firstTimers: [],
  };
}

export interface StoreBackend {
  name: string;
  load(): Promise<Partial<BotState> | null>;
  save(state: BotState): Promise<void>;
}

export class MemoryBackend implements StoreBackend {
  name = "memory";
  data: BotState | null = null;
  async load() {
    return this.data ? structuredClone(this.data) : null;
  }
  async save(state: BotState) {
    this.data = structuredClone(state);
  }
}

export class FileBackend implements StoreBackend {
  name: string;
  constructor(private path: string) {
    this.name = `file ${path}`;
  }
  async load() {
    try {
      return JSON.parse(await readFile(this.path, "utf-8")) as Partial<BotState>;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }
  async save(state: BotState) {
    await mkdir(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    await writeFile(tmp, JSON.stringify(state, null, 2));
    await rename(tmp, this.path);
  }
}

// One document `{ _id: "state", ...BotState }` in the given collection.
export class MongoBackend implements StoreBackend {
  name = "mongodb";
  private collection: Promise<import("mongodb").Collection<{ _id: string } & Partial<BotState>>>;
  constructor(uri: string, dbName: string) {
    this.collection = import("mongodb").then(async ({ MongoClient }) => {
      const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
      await client.connect();
      return client.db(dbName).collection<{ _id: string } & Partial<BotState>>("bot_state");
    });
  }
  async load() {
    const doc = await (await this.collection).findOne({ _id: "state" });
    if (!doc) return null;
    const { _id, ...state } = doc;
    return state;
  }
  async save(state: BotState) {
    await (await this.collection).replaceOne({ _id: "state" }, { ...state }, { upsert: true });
  }
}

const MAX_ANNOUNCED = 500;
const MAX_FIRST_TIMERS = 100;

let backend: StoreBackend = new MemoryBackend();
let state: BotState = emptyState();
let saving: Promise<void> = Promise.resolve();

export function createBackendFromEnv(env: NodeJS.ProcessEnv = process.env): StoreBackend {
  if (env.BOT_MONGODB_URI) return new MongoBackend(env.BOT_MONGODB_URI, env.BOT_MONGODB_DB || "txio_bot");
  return new FileBackend(env.STATE_FILE || "data/bot-state.json");
}

/** Loads state from the backend. A load failure keeps the bot running on empty state. */
export async function initStore(next: StoreBackend): Promise<void> {
  backend = next;
  try {
    state = { ...emptyState(), ...((await backend.load()) ?? {}) };
    console.log(`State loaded from ${backend.name} (${state.announced.length} announced releases)`);
  } catch (error) {
    console.error(`Failed to load state from ${backend.name}; starting empty:`, error);
    state = emptyState();
  }
}

/** Read-only view for callers; change state only through `updateState`. */
export function getState(): Readonly<BotState> {
  return state;
}

/** Applies `change` and saves. Saves are serialized; a failed save is logged. */
export function updateState(change: (draft: BotState) => void): Promise<void> {
  change(state);
  if (state.announced.length > MAX_ANNOUNCED) state.announced = state.announced.slice(-MAX_ANNOUNCED);
  if (state.firstTimers.length > MAX_FIRST_TIMERS) state.firstTimers = state.firstTimers.slice(-MAX_FIRST_TIMERS);
  const snapshot = structuredClone(state);
  saving = saving
    .then(() => backend.save(snapshot))
    .catch((error) => console.error(`Failed to save state to ${backend.name}:`, error));
  return saving;
}

export function isAnnounced(key: string): boolean {
  return state.announced.includes(key);
}

export function markAnnounced(key: string): Promise<void> {
  return updateState((s) => {
    if (!s.announced.includes(key)) s.announced.push(key);
  });
}

/** Test helper: resets to empty in-memory state. */
export function resetStoreForTests(): void {
  backend = new MemoryBackend();
  state = emptyState();
  saving = Promise.resolve();
}
