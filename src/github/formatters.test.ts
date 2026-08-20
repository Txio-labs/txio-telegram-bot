import { describe, expect, it } from "vitest";
import { link } from "./formatters.js";

describe("link", () => {
  it("escapes URLs to prevent attribute breakout", () => {
    const maliciousUrl = 'https://example.com/test" onclick="alert(1)';

    expect(link(maliciousUrl, "Click Here")).toBe(
      '<a href="https://example.com/test&quot; onclick=&quot;alert(1)">Click Here</a>',
    );
  });
});
