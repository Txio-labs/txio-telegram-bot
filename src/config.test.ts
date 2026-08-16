import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const requiredConfig = {
  TELEGRAM_BOT_TOKEN: "test-token",
  TELEGRAM_CHAT_ID: "test-chat",
  GITHUB_WEBHOOK_SECRET: "test-secret",
  PUBLIC_URL: "https://example.test",
};

let required: (name: string) => string;
let optionalInt: (name: string) => number | undefined;

beforeAll(async () => {
  for (const [name, value] of Object.entries(requiredConfig)) {
    vi.stubEnv(name, value);
  }
  ({ required, optionalInt } = await import("./config.js"));
});

afterAll(() => {
  vi.unstubAllEnvs();
});

describe("required", () => {
  it("returns an environment variable's value", () => {
    vi.stubEnv("TEST_REQUIRED_PRESENT", "configured");

    expect(required("TEST_REQUIRED_PRESENT")).toBe("configured");
  });

  it("throws when an environment variable is missing", () => {
    vi.stubEnv("TEST_REQUIRED_MISSING", "");

    expect(() => required("TEST_REQUIRED_MISSING")).toThrow(
      "Missing required environment variable: TEST_REQUIRED_MISSING",
    );
  });
});

describe("optionalInt", () => {
  it("returns undefined when an environment variable is missing", () => {
    vi.stubEnv("TEST_OPTIONAL_INT_MISSING", "");

    expect(optionalInt("TEST_OPTIONAL_INT_MISSING")).toBeUndefined();
  });

  it("returns a parsed number when an environment variable is present", () => {
    vi.stubEnv("TEST_OPTIONAL_INT_PRESENT", "42");

    expect(optionalInt("TEST_OPTIONAL_INT_PRESENT")).toBe(42);
  });
});
