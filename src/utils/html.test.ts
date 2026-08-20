import { describe, it, expect } from "vitest";
import { escapeHtml } from "./html.js";
import { link } from "../github/formatters.js";

describe("HTML escaping & link formatting", () => {
  it("escapes quotes in escapeHtml", () => {
    expect(escapeHtml('hello "world" <test>&')).toBe(
      "hello &quot;world&quot; &lt;test&gt;&amp;",
    );
  });

  it("escapes URL in link() to prevent attribute breakout", () => {
    const maliciousUrl = 'https://example.com/test" onclick="alert(1)';
    const result = link(maliciousUrl, "Click Here");
    expect(result).toBe(
      '<a href="https://example.com/test&quot; onclick=&quot;alert(1)">Click Here</a>',
    );
  });
});
