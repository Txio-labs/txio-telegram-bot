import { describe, expect, it } from "vitest";
import { escapeHtml } from "./html.js";

describe("escapeHtml", () => {
  it.each([
    ["fish & chips", "fish &amp; chips"],
    ["1 < 2", "1 &lt; 2"],
    ["2 > 1", "2 &gt; 1"],
    ["<tag>& value", "&lt;tag&gt;&amp; value"],
  ])("escapes %s", (input, expected) => {
    expect(escapeHtml(input)).toBe(expected);
  });
});
