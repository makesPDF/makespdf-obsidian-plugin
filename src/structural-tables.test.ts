/**
 * Tests for the Structural Tables adapter: the Ahriman fixture's `<` merges,
 * `^` row spans, multi-row and no column headers, row headers from `||`,
 * alignment, escaped markers, the invalid shapes that stay a pipe table, and
 * the fences a whole-document adapter must not touch.
 */
import { describe, it, expect } from "vitest";

import { preprocessObsidian } from "./preprocess";
import { buildPropertyTable } from "./properties";
import {
  AHRIMAN_STRUCTURAL_TABLE,
  ROWSPAN_STRUCTURAL_TABLE,
} from "./structural-tables-sample";
import {
  convertStructuralTables,
  structuralTablesToMarkdown,
} from "./structural-tables";

describe("Structural Tables: the Ahriman fixture", () => {
  it("renders every `<` row as one merged cell with no literal marker left", () => {
    const out = convertStructuralTables(AHRIMAN_STRUCTURAL_TABLE);

    expect(out).toBe(
      [
        "<table>",
        "<thead>",
        '<tr><th align="center">Script</th><th align="center">Sample</th><th align="center"></th><th align="center">Direction</th></tr>',
        "</thead>",
        "<tbody>",
        '<tr><td align="center">Avestan</td><td colspan="2" align="center">Ahuna Vairya</td><td align="center">Right to left</td></tr>',
        '<tr><td align="center">Pahlavi</td><td colspan="2" align="center">Dura-Europos</td><td align="center">Right to left</td></tr>',
        '<tr><td align="center">Hebrew</td><td colspan="2" align="center">Unpointed</td><td align="center">Right to left</td></tr>',
        '<tr><td align="center">Arabic</td><td colspan="2" align="center">Out of scope</td><td align="center">Right to left</td></tr>',
        "</tbody>",
        "</table>",
        "",
      ].join("\n"),
    );
  });

  it("leaves no merge marker in the rendered cells", () => {
    const out = convertStructuralTables(AHRIMAN_STRUCTURAL_TABLE);
    expect(out).not.toMatch(/>\s*<\s*</);
    expect(out).not.toContain("| < |");
  });

  it("keeps the text before and after the table", () => {
    const out = convertStructuralTables(`before\n\n${AHRIMAN_STRUCTURAL_TABLE}\n\nafter\n`);
    expect(out.startsWith("before\n\n<table>")).toBe(true);
    expect(out.endsWith("</table>\n\nafter\n")).toBe(true);
  });

  it("passes through preprocessObsidian without being rewritten", () => {
    // The adapter runs before the Obsidian-to-GFM pass; the generated HTML
    // must be ordinary markdown to it and come out byte for byte.
    const out = convertStructuralTables(`${AHRIMAN_STRUCTURAL_TABLE}\n`);
    expect(preprocessObsidian(out)).toBe(out);
  });
});

describe("Structural Tables: row spans", () => {
  it("merges `^` upward into a rowspan", () => {
    const out = convertStructuralTables(ROWSPAN_STRUCTURAL_TABLE);
    expect(out).toContain('<td rowspan="2">North</td><td align="center">10</td><td align="center">Q1</td>');
    expect(out).not.toContain("<td>^</td>");
    // The row below the merge carries only the cells the span does not cover.
    expect(out).toContain(
      '<tr><td align="center">12</td><td align="center">Q2</td></tr>',
    );
  });

  it("merges a whole rectangle when `<` and `^` are combined", () => {
    const out = convertStructuralTables(
      ["| --- | --- | --- |", "| A | < | B |", "| ^ | ^ | C |", "| D | E | F |"].join("\n"),
    );
    expect(out).toContain('<td colspan="2" rowspan="2">A</td>');
    expect(out).toContain("<tr><td>D</td><td>E</td><td>F</td></tr>");
    // The row the span covers still has a cell of its own (C), so it is a row.
    expect(out).toContain("<tr><td>C</td></tr>");
  });

  it("does not over-reach when a span covers a whole row", () => {
    const out = convertStructuralTables(
      ["| --- | --- |", "| A | < |", "| ^ | ^ |", "| C | D |"].join("\n"),
    );
    // The covered row is not emitted, so the span counts only the rows that
    // are: the anchor cell no longer spans at all.
    expect(out).toContain('<td colspan="2">A</td>');
    expect(out).not.toContain("rowspan");
    expect(out).not.toContain("<tr></tr>");
    expect(out).toContain("<tr><td>C</td><td>D</td></tr>");
  });
});

describe("Structural Tables: header rows", () => {
  it("keeps several rows above the delimiter in the thead", () => {
    const out = convertStructuralTables(
      ["| Region | Sales | < |", "| Quarter | Q1 | Q2 |", "| --- | --- | --- |", "| North | 10 | 12 |"].join(
        "\n",
      ),
    );
    expect(out).toContain(
      [
        "<thead>",
        '<tr><th>Region</th><th colspan="2">Sales</th></tr>',
        "<tr><th>Quarter</th><th>Q1</th><th>Q2</th></tr>",
        "</thead>",
      ].join("\n"),
    );
    expect(out).toContain("<tbody>\n<tr><td>North</td><td>10</td><td>12</td></tr>\n</tbody>");
  });

  it("renders a table that starts with the delimiter row without a thead", () => {
    const out = convertStructuralTables(
      ["| --- | --- | --- |", "| Alice | 10 | < |", "| Bob | 20 | 30 |"].join("\n"),
    );
    expect(out).not.toContain("<thead>");
    expect(out).toContain('<tbody>\n<tr><td>Alice</td><td colspan="2">10</td></tr>');
    expect(out).toContain("<tr><td>Bob</td><td>20</td><td>30</td></tr>");
  });

  it("turns the columns before `||` into row headers", () => {
    const out = convertStructuralTables(
      ["| --- || --- | --- |", "| Name | Alice | Bob |", "| Age | 28 | 31 |"].join("\n"),
    );
    expect(out).not.toContain("<thead>");
    expect(out).toContain("<tr><th>Name</th><td>Alice</td><td>Bob</td></tr>");
    expect(out).toContain("<tr><th>Age</th><td>28</td><td>31</td></tr>");
  });

  it("adds no column for the `||` divider", () => {
    const out = convertStructuralTables(
      ["| --- || --- | --- |", "| Name | Alice | Bob |"].join("\n"),
    );
    expect(out).toContain("<tr><th>Name</th><td>Alice</td><td>Bob</td></tr>");
  });

  it("handles the Structural Tables example: two header rows, `||`, `<` and `^`", () => {
    const out = convertStructuralTables(
      [
        "| Region  | Sales | <   |",
        "| Quarter | Q1    | Q2  |",
        "| ---     || ---  | --- |",
        "| North   | 10    | 12  |",
        "| ^       | 8     | 11  |",
      ].join("\n"),
    );
    expect(out).toContain('<tr><th>Region</th><th colspan="2">Sales</th></tr>');
    expect(out).toContain("<tr><th>Quarter</th><th>Q1</th><th>Q2</th></tr>");
    expect(out).toContain('<tr><th rowspan="2">North</th><td>10</td><td>12</td></tr>');
    expect(out).toContain("<tr><td>8</td><td>11</td></tr>");
  });
});

describe("Structural Tables: alignment", () => {
  it("maps the delimiter row's colons onto align", () => {
    const out = convertStructuralTables(
      ["| L | C | R |", "| :--- | :---: | ---: |", "| a | b | c |", "| ^ | d | e |"].join("\n"),
    );
    expect(out).toContain(
      '<tr><td rowspan="2">a</td><td align="center">b</td><td align="right">c</td></tr>',
    );
    expect(out).toContain('<tr><td align="center">d</td><td align="right">e</td></tr>');
  });
});

describe("Structural Tables: escaped markers", () => {
  it("prints `\\<` and `\\^` literally and still merges the real marker", () => {
    const out = convertStructuralTables(
      ["| H | H2 | H3 |", "| --- | --- | --- |", "| A | \\< | < |", "| \\^ | B | C |"].join(
        "\n",
      ),
    );
    expect(out).toContain("<tr><td>A</td><td colspan=\"2\">&lt;</td></tr>");
    expect(out).toContain("<tr><td>^</td><td>B</td><td>C</td></tr>");
    expect(out).not.toContain("\\<");
    expect(out).not.toContain("\\^");
  });

  it("prints an escaped `<` that looks like a tag as text, not live HTML", () => {
    const out = convertStructuralTables(
      ["| H | H2 | H3 |", "| --- | --- | --- |", "| a \\<b>x\\</b> | y | < |"].join("\n"),
    );
    // The escaped `<` is an entity before the tag-escaping pass runs, so it
    // cannot be reopened as a tag; the real `<` marker still merges column 2.
    expect(out).toContain('<tr><td>a &lt;b>x&lt;/b></td><td colspan="2">y</td></tr>');
    expect(out).not.toContain("<b>");
    expect(out).not.toContain("\\<");
    expect(out).not.toContain("\\^");
  });

  it("keeps a `\\|` as a literal pipe inside the merged cell", () => {
    const out = convertStructuralTables(
      ["| H | H2 |", "| --- | --- |", "| a \\| b | < |"].join("\n"),
    );
    expect(out).toContain('<td colspan="2">a | b</td>');
  });
});

describe("Structural Tables: only marker tables are translated", () => {
  it("leaves an ordinary GFM table byte for byte", () => {
    const md = ["| A | B |", "| --- | --- |", "| 1 | 2 |"].join("\n");
    expect(convertStructuralTables(md)).toBe(md);
  });

  it("leaves a lone pipe line and a pipe block without a delimiter alone", () => {
    const md = "| not | a table |\n| neither | is | this |";
    expect(convertStructuralTables(md)).toBe(md);
  });

  it("still translates a second table that does use a marker", () => {
    const md = [
      "| A | B |",
      "| --- | --- |",
      "| 1 | 2 |",
      "",
      "| C | D |",
      "| --- | --- |",
      "| 3 | < |",
    ].join("\n");
    const out = convertStructuralTables(md);
    expect(out).toContain("| A | B |");
    expect(out).toContain('<td colspan="2">3</td>');
  });

  it("leaves a table whose only special text is escaped alone", () => {
    const md = ["| A | B |", "| --- | --- |", "| \\< | \\^ |"].join("\n");
    expect(convertStructuralTables(md)).toBe(md);
  });
});

describe("Structural Tables: a table that breaks the rules stays a pipe table", () => {
  const cases: Record<string, string[]> = {
    "`^` with nothing above it": ["| ^ | B |", "| --- | --- |", "| 1 | 2 |"],
    "`<` with nothing to its left": ["| < | B |", "| --- | --- |", "| 1 | 2 |"],
    "a merge that is not a rectangle": [
      "| A | < | C |",
      "| --- | --- | --- |",
      "| D | ^ | F |",
    ],
    "a merge across the header boundary": [
      "| H | H2 |",
      "| --- | --- |",
      "| ^ | B |",
    ],
    "more cells than the delimiter row": [
      "| A | B |",
      "| --- | --- |",
      "| 1 | 2 | 3 |",
    ],
    "a header row shorter than the delimiter row": [
      "| A |",
      "| --- | --- |",
      "| 1 | 2 |",
    ],
    "two delimiter rows": [
      "| A | B |",
      "| --- | --- |",
      "| --- | --- |",
      "| 1 | 2 |",
    ],
    "more than one `||` divider": [
      "| --- || --- || --- |",
      "| 1 | 2 | 3 |",
    ],
  };

  for (const [name, lines] of Object.entries(cases)) {
    it(`leaves ${name} as written`, () => {
      const md = lines.join("\n");
      expect(convertStructuralTables(md)).toBe(md);
    });
  }

  it("leaves the table alone when a `^` is inside a horizontal merge", () => {
    const md = ["| A | < |", "| --- | --- |", "| B | ^ |"].join("\n");
    expect(convertStructuralTables(md)).toBe(md);
  });
});

describe("Structural Tables: fenced code is untouched", () => {
  it("does not translate a table inside a fenced block", () => {
    const md = ["```markdown", AHRIMAN_STRUCTURAL_TABLE, "```", ""].join("\n");
    expect(structuralTablesToMarkdown(md)).toBe(md);
  });

  it("does not translate a pipe table in the front matter", () => {
    const md = [
      "---",
      "title: Example",
      "table: |",
      "  | A | < |",
      "  | --- | --- |",
      "---",
      "",
      "| --- | --- |",
      "| A | < |",
    ].join("\n");
    const out = structuralTablesToMarkdown(md);
    expect(out.startsWith("---\ntitle: Example\ntable: |\n  | A | < |\n  | --- | --- |\n---\n")).toBe(
      true,
    );
    expect(out).toContain('<td colspan="2">A</td>');
  });

  it("translates the table outside the fence but not the one inside", () => {
    const md = [
      "```md",
      "| A | < |",
      "| --- | --- |",
      "```",
      "",
      "| --- | --- |",
      "| A | < |",
    ].join("\n");
    const out = structuralTablesToMarkdown(md);
    expect(out).toContain("```md\n| A | < |\n| --- | --- |\n```");
    expect(out).toContain('<td colspan="2">A</td>');
  });
});

describe("Structural Tables: the engine's cell cap", () => {
  it("leaves a marker table over 5,000 cells exactly as written", () => {
    // 2,501 rows x 2 columns = 5,002 cells, over the PDF engine's limit.
    const md = [
      "| A | B |",
      "| --- | --- |",
      ...Array.from({ length: 2_500 }, () => "| x | < |"),
    ].join("\n");
    expect(convertStructuralTables(md)).toBe(md);
  });

  it("still translates a marker table at exactly 5,000 cells", () => {
    // 2,500 rows x 2 columns = 5,000 cells, the last accepted size.
    const md = [
      "| A | B |",
      "| --- | --- |",
      ...Array.from({ length: 2_499 }, () => "| x | < |"),
    ].join("\n");
    expect(convertStructuralTables(md)).toContain('<td colspan="2">x</td>');
  });
});

describe("Structural Tables: a blockquote or callout table stays a pipe table", () => {
  it("leaves a `> `-prefixed table as written, as the README states", () => {
    const lines = ["| A | < |", "| --- | --- |", "| one | two |"].map(
      (line) => `> ${line}`,
    );
    const md = lines.join("\n");
    expect(convertStructuralTables(md)).toBe(md);
  });
});

describe("Structural Tables: the generated properties table", () => {
  it("does not read a property value of `<` or `^` as a merge marker", () => {
    const table = buildPropertyTable({ status: "<", owner: "^" }, "*");
    // The adapter runs after the properties table is inserted, so the markers
    // are escaped in the generated GFM and the table stays a pipe table.
    expect(table).toContain("| status | \\< |");
    expect(table).toContain("| owner | \\^ |");
    expect(convertStructuralTables(table)).toBe(table);
  });
});

describe("Structural Tables: cell content stays markdown", () => {
  it("resolves wikilinks, embeds and tags in the generated cells", () => {
    const md = [
      "| H | H2 | H3 |  |",
      "| --- | --- | --- | --- |",
      "| [[Page\\|Alias]] | ![[photo.png]] | see #tag | < |",
    ].join("\n");

    const out = preprocessObsidian(convertStructuralTables(md));

    expect(out).toContain("<td>Alias</td>");
    expect(out).toContain("![photo.png](<photo.png>)");
    expect(out).toContain("`#tag`");
  });

  it("keeps inline HTML but escapes a bare `<` and a table tag", () => {
    const out = convertStructuralTables(
      ["| H | H2 | H3 |", "| --- | --- | --- |", "| <b>bold</b> | a < b </td> | < |"].join(
        "\n",
      ),
    );
    expect(out).toContain("<td><b>bold</b></td>");
    expect(out).toContain('<td colspan="2">a &lt; b &lt;/td></td>');
    expect(out).toContain("</table>");
  });
});

describe("Structural Tables: separation from surrounding text", () => {
  it("puts a blank line after the table so a following paragraph is not absorbed", () => {
    const out = convertStructuralTables(`${AHRIMAN_STRUCTURAL_TABLE}\nThanks for reading.`);
    expect(out).toContain("</table>\n\nThanks for reading.");
  });

  it("keeps the indentation of a table inside a list item", () => {
    const md = ["- item", "", "  | A | < |", "  | --- | --- |", "  | 1 | 2 |"].join("\n");
    const out = structuralTablesToMarkdown(md);
    expect(out).toContain('  <table>\n  <thead>\n  <tr><th colspan="2">A</th></tr>');
  });
});
