import assert from "node:assert/strict";
import test from "node:test";
import { extractHtmlText, htmlToText } from "../lib/html-text.ts";

test("HTML extraction preserves bank alert amounts, card suffixes, and line breaks", () => {
  const html = '<html><body><div>Dear Customer,<br>Your card ending <b>1234</b></div><p>SGD&nbsp;12.34 at A &amp; B</p><table><tr><td>Date</td><td>7 Oct 2026</td></tr></table></body></html>';
  assert.equal(htmlToText(html), "Dear Customer,\nYour card ending 1234\n\nSGD 12.34 at A & B\n\nDate\n\n7 Oct 2026");
});

test("script end-tag whitespace and mixed casing cannot expose hidden text", () => {
  const document = extractHtmlText('<p>Before</p><ScRiPt>secret &amp; hidden</sCrIpT ><p>After</p>');
  assert.deepEqual(document.sections, ["Before", "After"]);
  assert.equal(document.text, "Before\n\nAfter");
});

test("hidden subtrees and comments are removed while visible nested text is retained", () => {
  const html = '<!-- hidden --><style>.hidden { color: red }</style><noscript><p>hidden</p></noscript><svg><title>hidden</title><text>hidden</text></svg><template><div><p>hidden</p></div></template><article><h2>Rates <em>today</em></h2><p>Paid <span>in <b>full</b></span>.</p></article>';
  const document = extractHtmlText(html);
  assert.deepEqual(document, { title: "", sections: ["Rates today", "Paid in full."], text: "Rates today\n\nPaid in full." });
});

test("entities are decoded exactly once and markup encoded as text remains plain text", () => {
  assert.equal(htmlToText('<p>&amp;lt;script&amp;gt; &lt;b&gt; &#38; &#x1F4B3; &quot; &apos; &unknown;</p>'), '&lt;script&gt; <b> & 💳 " \' &unknown;');
});

test("title and semantic sections tolerate implicit closing tags and blank sections", () => {
  const document = extractHtmlText('<title> Monetary &amp; Financial </title><title>Ignored title</title><h1>Headline</h1><p>First <strong>paragraph</strong><p>Second paragraph<ul><li>One<li>Two</ul><p> </p>');
  assert.equal(document.title, "Monetary & Financial");
  assert.deepEqual(document.sections, ["Headline", "First paragraph", "Second paragraph", "One", "Two"]);
});

test("empty input, plain text, nested sections, and unclosed hidden elements are safe", () => {
  assert.deepEqual(extractHtmlText(""), { title: "", sections: [], text: "" });
  assert.deepEqual(extractHtmlText("  Plain\ttext  "), { title: "", sections: [], text: "Plain text" });
  assert.deepEqual(extractHtmlText("<li><p>Nested paragraph</p></li>").sections, ["Nested paragraph"]);
  assert.equal(htmlToText("Visible<script>hidden"), "Visible");
  assert.equal(htmlToText("<div>A<br><br><br><br>B</div>"), "A\n\nB");
});
