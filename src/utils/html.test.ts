import { describe, expect, it } from "vitest";
import { escapeHtml } from "./html.js";

describe("escapeHtml", () => {
  it("escapes quotes and HTML special characters", () => {
    expect(escapeHtml('hello "world" <test>&')).toBe(
      "hello &quot;world&quot; &lt;test&gt;&amp;",
    );
  });
});
