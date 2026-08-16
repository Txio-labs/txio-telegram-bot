import { describe, it } from "node:test";
import assert from "node:assert";
import { escapeHtml } from "./src/utils/html.js";
import { link } from "./src/github/formatters.js";
import { isDuplicateDelivery, seenDeliveries } from "./src/github/webhooks.js";

describe("HTML escaping & link formatting", () => {
  it("escapes quotes in escapeHtml", () => {
    assert.strictEqual(escapeHtml('hello "world" <test>&'), "hello &quot;world&quot; &lt;test&gt;&amp;");
  });

  it("escapes URL in link() to prevent attribute breakout", () => {
    const maliciousUrl = 'https://example.com/test" onclick="alert(1)';
    const result = link(maliciousUrl, "Click Here");
    assert.strictEqual(
      result,
      '<a href="https://example.com/test&quot; onclick=&quot;alert(1)">Click Here</a>'
    );
  });
});

describe("Webhook deduplication", () => {
  it("detects duplicate deliveries and bounds cache", () => {
    seenDeliveries.clear();
    assert.strictEqual(isDuplicateDelivery("deliv-1"), false);
    assert.strictEqual(isDuplicateDelivery("deliv-1"), true);
    assert.strictEqual(isDuplicateDelivery("deliv-2"), false);
    assert.strictEqual(isDuplicateDelivery("deliv-2"), true);
  });
});
