/**
 * Tests for the verbatim-text escapers.
 *
 * `escapeVerbatimText` is covered through noteTitleHeading too, but the set is
 * now shared with image alt text, so it is pinned here character by character.
 * `escapeHtmlAttribute` is pinned to the exact character references the API's
 * HTML parser hands back.
 */

import { describe, expect, it } from "vitest";

import { escapeHtmlAttribute, escapeVerbatimText, VERBATIM_ESCAPE_RE } from "./escaping";

describe("escapeVerbatimText", () => {
  it("leaves ordinary text alone", () => {
    expect(escapeVerbatimText("plain alt text, 300 px")).toBe("plain alt text, 300 px");
    expect(escapeVerbatimText("")).toBe("");
  });

  it("escapes every character in the set", () => {
    // A copy without `g`, so `test` does not carry `lastIndex` between calls.
    const set = new RegExp(VERBATIM_ESCAPE_RE.source);
    for (const char of "\\`*_[]<>#=~%^&") {
      expect(set.test(char)).toBe(true);
      expect(escapeVerbatimText(`a${char}b`)).toBe(`a\\${char}b`);
    }
  });

  it("escapes a realistic alt", () => {
    expect(escapeVerbatimText("[Fig 1] a==b== #tag 50%% Tom & Jerry")).toBe(
      "\\[Fig 1\\] a\\=\\=b\\=\\= \\#tag 50\\%\\% Tom \\& Jerry",
    );
  });
});

describe("escapeHtmlAttribute", () => {
  it("leaves ordinary text alone", () => {
    expect(escapeHtmlAttribute("plain alt text, 300 px")).toBe("plain alt text, 300 px");
    expect(escapeHtmlAttribute("")).toBe("");
  });

  it("encodes the attribute delimiters and the markup characters", () => {
    expect(escapeHtmlAttribute('a&b"c<d>e')).toBe(
      "a&amp;b&quot;c&lt;d&gt;e",
    );
  });

  it("encodes every character in the shared set", () => {
    const expected: Record<string, string> = {
      "\\": "&#92;",
      "`": "&#96;",
      "*": "&#42;",
      _: "&#95;",
      "[": "&#91;",
      "]": "&#93;",
      "#": "&#35;",
      "=": "&#61;",
      "~": "&#126;",
      "%": "&#37;",
      "^": "&#94;",
      "&": "&amp;",
      '"': "&quot;",
      "<": "&lt;",
      ">": "&gt;",
    };
    for (const [char, encoded] of Object.entries(expected)) {
      expect(escapeHtmlAttribute(`a${char}b`)).toBe(`a${encoded}b`);
    }
    // `"` is the one addition: the markdown escaper leaves it alone (it is
    // literal in markdown) but it delimits the attribute.
    expect(escapeVerbatimText('"')).toBe('"');
    expect(escapeHtmlAttribute('"')).toBe("&quot;");
  });
});
