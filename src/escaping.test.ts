/**
 * Tests for the verbatim-text escapers.
 *
 * `escapeVerbatimText` is covered through noteTitleHeading too, but the set is
 * now shared with an image embed's alt and destination, so it is pinned here
 * character by character. `escapeHtmlAttribute` is pinned to the exact
 * character references the API's HTML parser hands back, and its two
 * directions (encode and decode) are checked against each other.
 */

import { describe, expect, it } from "vitest";

import {
  HTML_ATTRIBUTE_ESCAPE_RE,
  escapeHtmlAttribute,
  escapeVerbatimText,
  unescapeHtmlAttribute,
  unescapeVerbatimText,
  VERBATIM_ESCAPE_RE,
} from "./escaping";

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

describe("unescapeVerbatimText", () => {
  it("round-trips every character in the set", () => {
    for (const char of "\\`*_[]<>#=~%^&") {
      expect(unescapeVerbatimText(escapeVerbatimText(char))).toBe(char);
    }
    expect(unescapeVerbatimText(escapeVerbatimText("a (b) c.png"))).toBe("a (b) c.png");
  });

  it("leaves a backslash that is not an escape alone", () => {
    expect(unescapeVerbatimText("a\\qb.png")).toBe("a\\qb.png");
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

  it("encodes every character its regex matches", () => {
    // The regex and the map are two separate lists; a character the regex
    // matches but the map lacks makes `replace` insert the literal text
    // `undefined`. Deriving the characters from the regex source checks the
    // direction the per-map loop above cannot.
    const classBody = HTML_ATTRIBUTE_ESCAPE_RE.source.slice(1, -1);
    for (const char of classBody.replace(/\\(.)/g, "$1")) {
      expect(escapeHtmlAttribute(char)).toMatch(/^&(?:#\d+|\w+);$/);
    }
  });
});

describe("unescapeHtmlAttribute", () => {
  it("round-trips every character in the set", () => {
    for (const char of '&"<>\\`*_[]#=~%^') {
      expect(unescapeHtmlAttribute(escapeHtmlAttribute(char))).toBe(char);
    }
    expect(unescapeHtmlAttribute(escapeHtmlAttribute("/a (b)/c.png"))).toBe("/a (b)/c.png");
  });

  it("leaves an entity it did not write alone", () => {
    expect(unescapeHtmlAttribute("a&nbsp;b")).toBe("a&nbsp;b");
  });
});
