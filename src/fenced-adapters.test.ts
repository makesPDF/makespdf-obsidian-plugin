/**
 * Tests for the adapter registry: which blocks it translates, what it leaves
 * alone, and how the saved on/off settings are read.
 */
import { describe, it, expect } from "vitest";

import {
  BUNDLED_ADAPTERS,
  BUNDLED_MARKDOWN_ADAPTERS,
  applyFencedAdapters,
  applyMarkdownAdapters,
  defaultFencedAdapterSettings,
  defaultMarkdownAdapterSettings,
  isAdapterEnabled,
  isMarkdownAdapterEnabled,
  normalizeFencedAdapterSettings,
  normalizeMarkdownAdapterSettings,
} from "./fenced-adapters";
import { preprocessObsidian } from "./preprocess";
import { STRUCTURAL_TABLES_PLUGIN_ID } from "./structural-tables";

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
    expect(out.endsWith("</table>\n\nafter\n")).toBe(true);
  });

  it("separates the table from a following text line with a blank line", () => {
    const out = applyFencedAdapters("```vtable\n" + SAMPLE + "\n```\nThanks for reading.\n", {
      vtable: true,
    });
    expect(out).toContain("</table>\n\nThanks for reading.\n");
  });

  it("separates the table from a following list item with a blank line", () => {
    const out = applyFencedAdapters("```vtable\n" + SAMPLE + "\n```\n- next item\n", {
      vtable: true,
    });
    expect(out).toContain("</table>\n\n- next item\n");
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
    expect(out.endsWith("</table>\n\n")).toBe(true);
  });

  it("leaves the block as written when an adapter throws", () => {
    const throwing = [
      {
        id: "boom",
        fence: "boom",
        name: "Boom",
        description: "",
        aliases: [],
        toMarkdown: () => {
          throw new RangeError("Maximum call stack size exceeded");
        },
      },
    ];
    const md = "before\n```boom\nx\n```\nafter\n";
    expect(applyFencedAdapters(md, {}, throwing)).toBe(md);
  });

  it("does not throw on a deeply nested vtable formula", () => {
    const source = JSON.stringify({
      rows: [[{ t: "h" }], [{ f: "=" + "(".repeat(5_000) + "1" + ")".repeat(5_000) }]],
    });
    const md = "```vtable\n" + source + "\n```\n";

    const out = applyFencedAdapters(md, { vtable: true });

    expect(out).toContain("<table>");
    expect(out).toContain("could not be calculated");
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

  it("takes the adapter kind's default when nothing is stored", () => {
    expect(isAdapterEnabled(undefined, "structural-tables", false)).toBe(false);
    expect(isAdapterEnabled({}, "structural-tables", false)).toBe(false);
    expect(isAdapterEnabled({ "structural-tables": true }, "structural-tables", false)).toBe(
      true,
    );
  });
});

describe("BUNDLED_MARKDOWN_ADAPTERS", () => {
  it("contains the Structural Tables adapter, off by default", () => {
    const adapter = BUNDLED_MARKDOWN_ADAPTERS.find(
      (candidate) => candidate.id === STRUCTURAL_TABLES_PLUGIN_ID,
    );
    expect(adapter?.pluginId).toBe("structural-tables");
    expect(defaultMarkdownAdapterSettings()).toEqual({ "structural-tables": false });
  });
});

describe("normalizeMarkdownAdapterSettings", () => {
  it("returns every adapter off for a missing or non-object value", () => {
    expect(normalizeMarkdownAdapterSettings(undefined)).toEqual({ "structural-tables": false });
    expect(normalizeMarkdownAdapterSettings(null)).toEqual({ "structural-tables": false });
    expect(normalizeMarkdownAdapterSettings("on")).toEqual({ "structural-tables": false });
    expect(normalizeMarkdownAdapterSettings([true])).toEqual({ "structural-tables": false });
  });

  it("keeps a stored boolean and ignores a stale adapter", () => {
    expect(normalizeMarkdownAdapterSettings({ "structural-tables": true })).toEqual({
      "structural-tables": true,
    });
    expect(normalizeMarkdownAdapterSettings({ removed: true })).toEqual({
      "structural-tables": false,
    });
    expect(normalizeMarkdownAdapterSettings({ "structural-tables": "yes" })).toEqual({
      "structural-tables": false,
    });
  });
});

describe("isMarkdownAdapterEnabled", () => {
  const adapter = BUNDLED_MARKDOWN_ADAPTERS[0];

  it("is off unless the saved value is true", () => {
    expect(isMarkdownAdapterEnabled(undefined, adapter)).toBe(false);
    expect(isMarkdownAdapterEnabled({}, adapter)).toBe(false);
    expect(isMarkdownAdapterEnabled({ "structural-tables": true }, adapter)).toBe(true);
    expect(isMarkdownAdapterEnabled({ "structural-tables": false }, adapter)).toBe(false);
  });
});

describe("applyMarkdownAdapters", () => {
  const table = ["| A | < |", "| --- | --- |", "| one | two |"].join("\n") + "\n";
  const disabled = () => false;

  it("stays off when the setting is off and the plugin is not enabled", () => {
    expect(applyMarkdownAdapters(table, { "structural-tables": false }, disabled)).toBe(table);
    expect(applyMarkdownAdapters(table, {}, disabled)).toBe(table);
    expect(applyMarkdownAdapters(table, undefined, disabled)).toBe(table);
  });

  it("runs when the setting is on", () => {
    const out = applyMarkdownAdapters(table, { "structural-tables": true }, disabled);
    expect(out).toContain("<table>");
    expect(out).toContain('<th colspan="2">A</th>');
  });

  it("runs when the third-party plugin is enabled, even with the setting off", () => {
    const out = applyMarkdownAdapters(
      table,
      { "structural-tables": false },
      (pluginId) => pluginId === "structural-tables",
    );
    expect(out).toContain("<table>");
  });

  it("leaves a fence alone while translating the table outside it", () => {
    const md = `\`\`\`md\n${table}\`\`\`\n\n${table}`;
    const out = applyMarkdownAdapters(md, { "structural-tables": true }, disabled);
    expect(out).toContain("```md\n| A | < |\n| --- | --- |\n| one | two |\n```\n");
    expect(out).toContain("<table>");
  });

  it("leaves the document alone when an adapter throws", () => {
    const throwing = [
      {
        id: "boom",
        pluginId: "boom",
        name: "Boom",
        description: "",
        aliases: [],
        transform: () => {
          throw new RangeError("boom");
        },
      },
    ];
    expect(applyMarkdownAdapters("a\n", { boom: true }, disabled, throwing)).toBe("a\n");
  });

  it("hands the translated cells to preprocessObsidian as ordinary markdown", () => {
    const md = [
      "| H | H2 | H3 |",
      "| --- | --- | --- |",
      "| [[Page]] | see #tag | < |",
    ].join("\n");

    const out = preprocessObsidian(
      applyMarkdownAdapters(md, { "structural-tables": true }, disabled),
    );

    expect(out).toContain("<td>Page</td>");
    expect(out).toContain('<td colspan="2">see `#tag`</td>');
  });
});
