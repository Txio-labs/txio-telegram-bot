import { timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import { config } from "../config.js";
import { announceRelease, productForRepo, type AnnounceDeps } from "./announce.js";

function tokenMatches(header: string | undefined, expected: string): boolean {
  const given = Buffer.from(header?.replace(/^Bearer\s+/i, "") ?? "");
  const want = Buffer.from(expected);
  return given.length === want.length && timingSafeEqual(given, want);
}

const REPO_PATTERN = /^[\w.-]+\/[\w.-]+$/;
const TAG_PATTERN = /^[\w.+-]{1,100}$/;

/**
 * POST /announce/release  { "repo": "owner/name", "tag": "v1.2.3" }
 * Authorization: Bearer <ANNOUNCE_TOKEN>
 *
 * 200 announced / duplicate / skipped; 4xx bad request (do not retry);
 * 502 GitHub or Telegram failed (retry).
 */
export function createAnnounceReleaseHandler(deps: AnnounceDeps = {}) {
  return async (req: Request, res: Response): Promise<void> => {
    const token = config.announce?.token;
    if (!token) {
      res.status(404).json({ error: "announcements endpoint disabled (ANNOUNCE_TOKEN unset)" });
      return;
    }
    if (!tokenMatches(req.get("authorization"), token)) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }

    const { repo, tag } = (req.body ?? {}) as { repo?: unknown; tag?: unknown };
    if (typeof repo !== "string" || !REPO_PATTERN.test(repo) || typeof tag !== "string" || !TAG_PATTERN.test(tag)) {
      res.status(400).json({ error: 'body must be {"repo": "owner/name", "tag": "v1.2.3"}' });
      return;
    }
    const product = productForRepo(repo);
    if (!product || product.trigger === "deploy") {
      res.status(403).json({ error: `${repo} is not a product with GitHub releases` });
      return;
    }

    try {
      const result = await announceRelease(product, tag, "release workflow", deps);
      res.status(200).json(result);
    } catch (error) {
      console.error(`[announce] ${repo}@${tag} failed:`, error);
      res.status(502).json({ error: (error as Error).message });
    }
  };
}

export const announceReleaseHandler = createAnnounceReleaseHandler();
