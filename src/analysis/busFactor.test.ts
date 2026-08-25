import { describe, expect, it } from "vitest";
import { calculateAuthorshipConcentration } from "./busFactor.js";

describe("calculateAuthorshipConcentration", () => {
  it("flags concentrated files and ranks them by concentration", () => {
    const risks = calculateAuthorshipConcentration([
      { author: "alice", files: ["src/risky.ts", "src/shared.ts"] },
      { author: "alice", files: ["src/risky.ts"] },
      { author: "bob", files: ["src/risky.ts", "src/shared.ts"] },
      { author: "alice", files: ["src/shared.ts"] },
      { author: "carol", files: ["src/shared.ts"] },
    ], { thresholdPercent: 60, minCommits: 3, topFiles: 5 });

    expect(risks).toEqual([{ path: "src/risky.ts", dominantAuthor: "alice", dominantCommits: 2, totalCommits: 3, concentrationPercent: (2 / 3) * 100 }]);
  });

  it("excludes small histories, bots, and duplicate files in one commit", () => {
    const risks = calculateAuthorshipConcentration([
      { author: "dependabot[bot]", files: ["package-lock.json"] },
      { author: "alice", files: ["src/new.ts", "src/new.ts"] },
      { author: "alice", files: ["src/new.ts"] },
    ], { thresholdPercent: 70, minCommits: 3, topFiles: 5 });
    expect(risks).toEqual([]);
  });
});