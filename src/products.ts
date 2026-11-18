import { readFileSync } from "node:fs";

/**
 * Something Txio ships to users, and how the bot learns about a new version.
 *
 * - `workflow`: a GitHub Actions workflow builds installers and publishes a
 *   GitHub release (desktop). Announced when that workflow succeeds.
 * - `release`: a GitHub release is the new version (CLI, SDK). Announced on
 *   `release.published`, and when a new version appears on crates.io or npm.
 * - `deploy`: a production deployment (web app). Announced on a successful
 *   `deployment_status` in `environment`, only when user-facing commits shipped.
 */
export type Product = {
  id: string;
  name: string;
  repo: string;
  trigger: "workflow" | "release" | "deploy";
  /** `workflow` products: name of the workflow that publishes the release. */
  workflow?: string;
  /** `deploy` products: deployment environment, compared case-insensitively. */
  environment?: string;
  /** Link shown on posts, e.g. the web app or a download page. */
  url?: string;
  /** Install command shown on posts, e.g. `cargo install txio`. */
  install?: string;
  /** crates.io crate name to watch for new versions. */
  crate?: string;
  /** npm package name to watch for new versions. */
  npm?: string;
};

export const DEFAULT_PRODUCTS: Product[] = [
  {
    id: "desktop",
    name: "Txio Desktop",
    repo: "txio-labs/txio-desktop",
    trigger: "workflow",
    workflow: "Release",
    url: "https://txio-labs.github.io/txio-desktop/",
  },
  {
    id: "cli",
    name: "Txio CLI",
    repo: "txio-labs/txio-cli",
    trigger: "release",
    install: "cargo install txio",
    crate: "txio",
  },
  {
    id: "sdk",
    name: "Txio SDK",
    repo: "txio-labs/txio-sdk",
    trigger: "release",
    install: "npm install @txio/sdk",
    npm: "@txio/sdk",
  },
  {
    id: "web",
    name: "Txio Web",
    repo: "txio-labs/txio",
    trigger: "deploy",
    environment: "Production",
    url: "https://txio.xyz",
  },
];

const TRIGGERS = ["workflow", "release", "deploy"];

export function parseProducts(raw: unknown, source: string): Product[] {
  if (!Array.isArray(raw)) throw new Error(`${source} must be a JSON array of products`);
  const ids = new Set<string>();
  return raw.map((entry, index) => {
    const p = entry as Partial<Product>;
    const where = `${source}[${index}]`;
    if (!p || typeof p !== "object") throw new Error(`${where} must be an object`);
    for (const key of ["id", "name", "repo"] as const) {
      if (typeof p[key] !== "string" || !p[key]) throw new Error(`${where}.${key} must be a non-empty string`);
    }
    if (!/^[a-z0-9-]+$/.test(p.id as string)) throw new Error(`${where}.id must be lowercase letters, digits or dashes`);
    if (ids.has(p.id as string)) throw new Error(`${where}.id "${p.id}" is used twice`);
    ids.add(p.id as string);
    if (!TRIGGERS.includes(p.trigger as string)) throw new Error(`${where}.trigger must be one of ${TRIGGERS.join(", ")}`);
    if (p.trigger === "workflow" && !p.workflow) throw new Error(`${where}.workflow is required for trigger "workflow"`);
    if (p.trigger === "deploy" && !p.environment) throw new Error(`${where}.environment is required for trigger "deploy"`);
    return { ...p, repo: (p.repo as string).toLowerCase() } as Product;
  });
}

export function loadProducts(env: NodeJS.ProcessEnv = process.env): Product[] {
  const path = env.ANNOUNCE_PRODUCTS_PATH;
  if (!path) return DEFAULT_PRODUCTS;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf-8"));
  } catch (error) {
    throw new Error(`Failed to read ANNOUNCE_PRODUCTS_PATH "${path}": ${(error as Error).message}`);
  }
  return parseProducts(raw, `ANNOUNCE_PRODUCTS_PATH "${path}"`);
}

export function findProductByRepo(products: Product[], repo: string | undefined): Product | undefined {
  if (!repo) return undefined;
  const key = repo.toLowerCase();
  return products.find((p) => p.repo === key);
}

export function findProductById(products: Product[], id: string | undefined): Product | undefined {
  if (!id) return undefined;
  const key = id.toLowerCase();
  return products.find((p) => p.id === key);
}
