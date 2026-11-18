/**
 * Tests for the adapter registry: which blocks it translates, what it leaves
 * alone, and how the saved on/off settings are read.
 */
import { describe, it, expect } from "vitest";

import {
  BUNDLED_ADAPTERS,
  applyFencedAdapters,
  defaultFencedAdapterSettings,
  isAdapterEnabled,
  normalizeFencedAdapterSettings,
} from "./fenced-adapters";
import { preprocessObsidian } from "./preprocess";

const SAMPLE = '{"rows":[[{"t":"Example merged cell 1","rs":1,"cs":2,"a":"c"},{"t":"","rs":0,"cs":0}]]}';

/** Markdown with one vtable block between prose. */
function note(source = SAMPLE): string {
  return `before\n\`\`\`vtable\n${source}\n\`\`\`\nafter\n`;
}

describe("BUNDLED_ADAPTERS", () => {
  it("contains the vtable adapter, on by default", () => {
    const vtable = BUNDLED_ADAPTERS.find((adapter) => adapter.id === "vtable");
    expect(vtable?.fence).toBe("vtable");
    expect(defaultFencedAdapterSettings()).toEqual({ vtable: true });
  });
});

describe("applyFencedAdapters", () => {
  it("translates a matching block and keeps the surrounding text", () => {
    const out = applyFencedAdapters(note(), { vtable: true });
    expect(out).not.toContain("```vtable");
    expect(out).toContain("<table>");
    expect(out).toContain('<th colspan="2" align="center">Example merged cell 1</th>');
    expect(out.startsWith("before\n<table>")).toBe(true);
    expect(out.endsWith("</table>\nafter\n")).toBe(true);
  });

  it("leaves the block exactly as written when the adapter is off", () => {
    const md = note();
    expect(applyFencedAdapters(md, { vtable: false })).toBe(md);
  });

  it("leaves an invalid block as a code block", () => {
    const md = note("{not json}");
    expect(applyFencedAdapters(md, { vtable: true })).toBe(md);
  });

  it("leaves unrelated fences alone", () => {
    const md = "```json\n{\"a\":1}\n```\n```js\nconst a = 1;\n```\n";
    expect(applyFencedAdapters(md, { vtable: true })).toBe(md);
  });

  it("matches the info string case-insensitively and ignores extra info", () => {
    const out = applyFencedAdapters("```Vtable title=\"x\"\n" + SAMPLE + "\n```\n", {
      vtable: true,
    });
    expect(out).toContain("<table>");
  });

  it("keeps a block's indentation on every output line", () => {
    const out = applyFencedAdapters(`- item\n\n  \`\`\`vtable\n  ${SAMPLE}\n  \`\`\`\n`, {
      vtable: true,
    });
    expect(out).toContain("  <table>\n  <thead>");
  });

  it("adds the missing final newline at the end of a document", () => {
    const out = applyFencedAdapters("```vtable\n" + SAMPLE + "\n```", { vtable: true });
    expect(out.endsWith("</table>\n")).toBe(true);
  });

  it("is a no-op only when every adapter is explicitly off", () => {
    const md = note();
    expect(applyFencedAdapters(md, { vtable: false })).toBe(md);
    expect(applyFencedAdapters(md, {})).toContain("<table>");
  });

  it("hands the translated cells to preprocessObsidian as ordinary markdown", () => {
    const source = JSON.stringify({
      rows: [[{ t: "[[Page]] and ![[photo.png]] and #tag" }]],
    });
    const md = `\`\`\`vtable\n${source}\n\`\`\`\n`;

    const out = preprocessObsidian(applyFencedAdapters(md, { vtable: true }));

    expect(out).toContain('<th>Page and ![photo.png](<photo.png>) and `#tag`</th>');
  });

  it("keeps a hex background colour through preprocessObsidian", () => {
    const source = '{"rows":[[{"t":"head","bg":"#f6f8fa"}]]}';
    const md = `\`\`\`vtable\n${source}\n\`\`\`\n`;

    const out = preprocessObsidian(applyFencedAdapters(md, { vtable: true }));

    expect(out).toContain('<th style="background-color: #f6f8fa">head</th>');
  });

  it("drops a vtable block that is inside a %% comment, on or off", () => {
    const md = `%%\n\`\`\`vtable\n${SAMPLE}\n\`\`\`\n%%\n`;
    expect(preprocessObsidian(applyFencedAdapters(md, { vtable: true }))).toBe("\n");
    expect(preprocessObsidian(applyFencedAdapters(md, { vtable: false }))).toBe("\n");
  });
});

describe("normalizeFencedAdapterSettings", () => {
  it("returns every adapter on for a missing or non-object value", () => {
    expect(normalizeFencedAdapterSettings(undefined)).toEqual({ vtable: true });
    expect(normalizeFencedAdapterSettings(null)).toEqual({ vtable: true });
    expect(normalizeFencedAdapterSettings("no")).toEqual({ vtable: true });
    expect(normalizeFencedAdapterSettings([false])).toEqual({ vtable: true });
  });

  it("keeps a stored boolean", () => {
    expect(normalizeFencedAdapterSettings({ vtable: false })).toEqual({ vtable: false });
    expect(normalizeFencedAdapterSettings({ vtable: true })).toEqual({ vtable: true });
  });

  it("falls back to the default for a non-boolean or unknown adapter", () => {
    expect(normalizeFencedAdapterSettings({ vtable: "off" })).toEqual({ vtable: true });
    expect(normalizeFencedAdapterSettings({ removed: false })).toEqual({ vtable: true });
  });
});

describe("isAdapterEnabled", () => {
  it("is on unless explicitly false", () => {
    expect(isAdapterEnabled(undefined, "vtable")).toBe(true);
    expect(isAdapterEnabled({}, "vtable")).toBe(true);
    expect(isAdapterEnabled({ vtable: true }, "vtable")).toBe(true);
    expect(isAdapterEnabled({ vtable: false }, "vtable")).toBe(false);
  });
});
