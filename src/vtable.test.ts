/**
 * Tests for the Vtable adapter: the user's sample, the span/alignment/colour
 * mapping, the table directives, the extras that become text, and the
 * invalid-input path that leaves a block as code.
 */
import { describe, it, expect } from "vitest";

import { vtableToMarkdown } from "./vtable";
import { VTABLE_SAMPLE } from "./vtable-sample";

/** A one-row table's source, for the small cases below. */
function table(rows: unknown, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ rows, ...extra });
}

describe("vtableToMarkdown: the user's sample", () => {
  it("renders the fixture's merged cells as an HTML table", () => {
    expect(vtableToMarkdown(VTABLE_SAMPLE)).toBe(
      [
        "<table>",
        "<thead>",
        '<tr><th colspan="2" align="center">Example merged cell 1</th></tr>',
        "</thead>",
        "<tbody>",
        '<tr><td colspan="2" align="center">Example merged cell 2</td></tr>',
        '<tr><td align="center">Example cell left 1</td><td align="center">Example cell right 1</td></tr>',
        "</tbody>",
        "</table>",
        "",
      ].join("\n"),
    );
  });

  it("ignores colWidths rather than sizing columns from it", () => {
    expect(vtableToMarkdown(VTABLE_SAMPLE)).not.toContain("621");
    expect(vtableToMarkdown(VTABLE_SAMPLE)).not.toContain("width");
  });
});

describe("vtableToMarkdown: spans and header", () => {
  it("makes the first row a thead of th cells and later rows tbody td cells", () => {
    const html = vtableToMarkdown(
      table([
        [{ t: "Head" }, { t: "Also head" }],
        [{ t: "Body" }, { t: "Also body" }],
      ]),
    );
    expect(html).toContain("<thead>\n<tr><th>Head</th><th>Also head</th></tr>\n</thead>");
    expect(html).toContain("<tbody>\n<tr><td>Body</td><td>Also body</td></tr>\n</tbody>");
  });

  it("maps row and column spans and skips covered placeholders", () => {
    const html = vtableToMarkdown(
      table([
        [{ t: "top left", rs: 2, cs: 1 }, { t: "top right" }],
        [{ t: "", rs: 0, cs: 0 }, { t: "bottom right" }],
        [{ t: "last" }, { t: "last right" }],
      ]),
    );
    expect(html).toContain('<th rowspan="2">top left</th><th>top right</th>');
    expect(html).toContain('<td>bottom right</td>');
    expect(html).not.toContain('rs="0"');
    expect((html ?? "").match(/<td/g)).toHaveLength(3);
  });

  it("skips a placeholder whose span is only partly zero", () => {
    const html = vtableToMarkdown(
      table([
        [{ t: "head" }],
        [{ t: "", rs: 0, cs: 1 }],
        [{ t: "real" }],
      ]),
    );
    expect(html).toContain("<td>real</td>");
    expect(html).not.toContain("<td></td>");
  });

  it("omits a body row that has no visible cells", () => {
    const html = vtableToMarkdown(
      table([
        [{ t: "head" }],
        [{ t: "", rs: 0, cs: 0 }],
        [{ t: "real" }],
      ]),
    );
    expect(html).not.toContain("<tr></tr>");
    expect((html ?? "").match(/<tr>/g)).toHaveLength(2);
  });

  it("treats string spans as numbers", () => {
    const html = vtableToMarkdown(
      table([
        [{ t: "head" }],
        [{ t: "spans", rs: "2", cs: "3" }],
      ]),
    );
    expect(html).toContain('<td colspan="3" rowspan="2">spans</td>');
  });

  it("clamps an absurd span to the engine's three digits", () => {
    const html = vtableToMarkdown(
      table([
        [{ t: "head" }],
        [{ t: "wide", cs: 100000 }],
      ]),
    );
    expect(html).toContain('colspan="999"');
  });

  it("returns null when the first row is all placeholders and no body is visible", () => {
    expect(vtableToMarkdown(table([[{ t: "", rs: 0, cs: 0 }]]))).toBeNull();
  });
});

describe("vtableToMarkdown: alignment and colour", () => {
  it("maps short and long horizontal alignment values", () => {
    expect(vtableToMarkdown(table([[{ t: "c", a: "c" }, { t: "r", a: "r" }]]))).toContain(
      '<th align="center">c</th><th align="right">r</th>',
    );
    expect(vtableToMarkdown(table([[{ t: "l", a: "left" }]]))).toContain("<th>l</th>");
  });

  it("maps vertical alignment values", () => {
    expect(vtableToMarkdown(table([[{ t: "m", va: "m" }, { t: "b", va: "bottom" }]]))).toContain(
      '<th valign="middle">m</th><th valign="bottom">b</th>',
    );
    expect(vtableToMarkdown(table([[{ t: "t", va: "top" }]]))).toContain("<th>t</th>");
  });

  it("maps a background colour to a style attribute", () => {
    expect(vtableToMarkdown(table([[{ t: "x", bg: "#f6f8fa" }]]))).toContain(
      'style="background-color: #f6f8fa"',
    );
    expect(vtableToMarkdown(table([[{ t: "x", bg: "lightblue" }]]))).toContain(
      'style="background-color: lightblue"',
    );
    expect(
      vtableToMarkdown(table([[{ t: "x", bg: "rgba(0, 0, 0, 0.25)" }]])),
    ).toContain('style="background-color: rgba(0, 0, 0, 0.25)"');
  });

  it("drops a background that is not a colour", () => {
    expect(vtableToMarkdown(table([[{ t: "x", bg: "url(javascript:alert(1))" }]]))).not.toContain(
      "style=",
    );
    expect(vtableToMarkdown(table([[{ t: "x", bg: 'red" onload="x' }]]))).not.toContain("style=");
  });
});

describe("vtableToMarkdown: table style directives", () => {
  it("emits our borderless directive for noline and off", () => {
    const noline = vtableToMarkdown(table([[{ t: "x" }]], { style: "noline" }));
    expect(noline?.startsWith("<!-- borderless -->\n<table>")).toBe(true);
    expect(vtableToMarkdown(table([[{ t: "x" }]], { style: "off" }))).toContain(
      "<!-- borderless -->",
    );
  });

  it("leaves the default borders for three and hline, which they already match", () => {
    expect(vtableToMarkdown(table([[{ t: "x" }]], { style: "three" }))).not.toContain(
      "<!--",
    );
    expect(vtableToMarkdown(table([[{ t: "x" }]], { style: "hline" }))).not.toContain(
      "<!--",
    );
  });

  it("ignores zebra and noHeaderBg, which have no per-table directive", () => {
    const html = vtableToMarkdown(
      table([[{ t: "x" }]], { zebra: true, noHeaderBg: true }),
    );
    expect(html).not.toContain("<!--");
    expect(html).toBe("<table>\n<thead>\n<tr><th>x</th></tr>\n</thead>\n</table>\n");
  });
});

describe("vtableToMarkdown: invalid input stays a code block", () => {
  it("returns null for invalid JSON", () => {
    expect(vtableToMarkdown("{not json}")).toBeNull();
    expect(vtableToMarkdown("")).toBeNull();
    expect(vtableToMarkdown("   ")).toBeNull();
  });

  it("returns null for JSON that is not a vtable table", () => {
    expect(vtableToMarkdown("[]")).toBeNull();
    expect(vtableToMarkdown("null")).toBeNull();
    expect(vtableToMarkdown('{"rows": "no"}')).toBeNull();
    expect(vtableToMarkdown('{"rows": []}')).toBeNull();
    expect(vtableToMarkdown('{"notRows": []}')).toBeNull();
    expect(vtableToMarkdown('{"rows": [[{"t":"a"}], "x"]}')).toBeNull();
    expect(vtableToMarkdown('{"rows": [[null]]}')).toBeNull();
  });

  it("renders a table longer than 500 rows, unless it passes the cell cap", () => {
    const rows = Array.from({ length: 501 }, () => [{ t: "x" }]);
    expect(vtableToMarkdown(table(rows))).toContain("</table>");

    // The cap is the engine's 5,000-cell one, not the row count.
    const wide = [Array.from({ length: 5_001 }, () => ({ t: "x" }))];
    expect(vtableToMarkdown(table(wide))).toBeNull();
    const tooManyRows = Array.from({ length: 5_001 }, () => [{ t: "x" }]);
    expect(vtableToMarkdown(table(tooManyRows))).toBeNull();
  });
});

describe("vtableToMarkdown: formulas", () => {
  it("computes an aggregate formula to its value", () => {
    const html = vtableToMarkdown(
      table([
        [{ t: "Item" }, { t: "Amount" }],
        [{ t: "A" }, { t: "2" }],
        [{ t: "B" }, { t: "3" }],
        [{ t: "Total" }, { f: "=SUM(B2:B3)" }],
      ]),
    );
    expect(html).toContain("<td>5</td>");
    expect(html).not.toContain("SUM");
  });

  it("computes arithmetic and references", () => {
    const html = vtableToMarkdown(
      table([
        [{ t: "a" }, { t: "b" }],
        [{ t: "2" }, { f: "=A2*3+1" }],
      ]),
    );
    expect(html).toContain("<td>7</td>");
  });

  it("computes a formula stored in the cell text", () => {
    const html = vtableToMarkdown(
      table([
        [{ t: "head" }],
        [{ t: "2" }],
        [{ t: "3" }],
        [{ t: "=SUM(A2:A3)" }],
      ]),
    );
    expect(html).toContain("<td>5</td>");
    expect(html).not.toContain("> Note:");
  });

  it("does not mistake prose starting with = for a formula", () => {
    const html = vtableToMarkdown(table([[{ t: "= not a formula" }]]));
    expect(html).toContain("<th>= not a formula</th>");
    expect(html).not.toContain("> Note:");

    const digits = vtableToMarkdown(table([[{ t: "= 5 items" }]]));
    expect(digits).toContain("<th>= 5 items</th>");
    expect(digits).not.toContain("> Note:");
  });

  it("fails an aggregate over a range that contains a failed formula", () => {
    const html = vtableToMarkdown(
      table([
        [{ t: "Item" }, { t: "Amount" }],
        [{ t: "A" }, { t: "1" }],
        [{ t: "B" }, { f: "=1/0" }],
        [{ t: "Total" }, { f: "=SUM(B2:B3)" }],
      ]),
    );
    expect(html).toContain("<td>=SUM(B2:B3)</td>");
    expect(html).toContain("could not be calculated");
  });

  it("fails a self-including aggregate instead of a partial total", () => {
    const html = vtableToMarkdown(
      table([
        [{ t: "head" }],
        [{ t: "1" }],
        [{ f: "=SUM(A1:A3)" }],
      ]),
    );
    expect(html).toContain("<td>=SUM(A1:A3)</td>");
    expect(html).toContain("could not be calculated");
  });

  it("resolves a reference to a merged cell through its anchor", () => {
    const html = vtableToMarkdown(
      table([
        [{ t: "10", cs: 2 }, { t: "", rs: 0, cs: 0 }],
        [{ t: "" }, { f: "=B1" }],
      ]),
    );
    expect(html).toContain("<td>10</td>");
  });

  it("shows a formula it cannot compute as text, with a note", () => {
    const html = vtableToMarkdown(
      table([
        [{ t: "head" }],
        [{ f: "=NOTAFUNCTION(1)" }],
      ]),
    );
    expect(html).toContain("<td>=NOTAFUNCTION(1)</td>");
    expect(html).toContain("> Note: formulas that could not be calculated are shown as text.");
  });

  it("fails a circular reference instead of hanging", () => {
    const html = vtableToMarkdown(
      table([
        [{ t: "head" }],
        [{ f: "=A2+1" }],
      ]),
    );
    expect(html).toContain("<td>=A2+1</td>");
    expect(html).toContain("could not be calculated");
  });
});

describe("vtableToMarkdown: extras become text with a note", () => {
  it("shows a chart as text with a note", () => {
    const html = vtableToMarkdown(
      table([[{ t: "Sales" }, { vbarchart: { data: [1, 2] } }]]),
    );
    expect(html).toContain("<th>[chart: vbarchart]</th>");
    expect(html).toContain("> Note: charts are shown as text.");
  });

  it("shows a chart's own text when it has one", () => {
    const html = vtableToMarkdown(
      table([[{ t: "Quarterly sales chart", vpie: { data: [1] } }]]),
    );
    expect(html).toContain("<th>Quarterly sales chart</th>");
  });

  it("shows a diagonal split cell as text with a note", () => {
    const html = vtableToMarkdown(
      table([[{ diag: { topLeft: "Sales", bottomRight: "Costs" } }]]),
    );
    expect(html).toContain("<th>Sales / Costs</th>");
    expect(html).toContain("diagonal split cells are shown as text");
  });

  it("shows inline math as text with a note", () => {
    const html = vtableToMarkdown(table([[{ t: "area $\\pi r^2$" }]]));
    expect(html).toContain("<th>area $\\pi r^2$</th>");
    expect(html).toContain("math is shown as text");
  });

  it("combines the notes it needed into one line", () => {
    const html = vtableToMarkdown(
      table([[{ t: "$x$" }, { vbarchart: {} }, { diag: "a / b" }]]),
    );
    expect(
      html?.match(/^> Note: .+$/gm),
    ).toHaveLength(1);
  });
});

describe("vtableToMarkdown: cell text", () => {
  it("keeps inline HTML and markdown for the engine", () => {
    const html = vtableToMarkdown(
      table([[{ t: "**bold** and <b>HTML</b> and [[a link]]" }]]),
    );
    expect(html).toContain("<th>**bold** and <b>HTML</b> and [[a link]]</th>");
  });

  it("escapes a stray angle bracket that cannot start a tag", () => {
    const html = vtableToMarkdown(table([[{ t: "a < b and x<y" }]]));
    expect(html).toContain("<th>a &lt; b and x&lt;y</th>");
  });

  it("escapes a literal table tag in the text so the table cannot break", () => {
    const html = vtableToMarkdown(table([[{ t: "use </td> here" }]]));
    expect(html).toContain("use &lt;/td> here");
  });

  it("turns newlines into br elements", () => {
    const html = vtableToMarkdown(table([[{ t: "one\ntwo" }]]));
    expect(html).toContain("<th>one<br>two</th>");
  });

  it("ignores unknown cell keys", () => {
    const html = vtableToMarkdown(table([[{ t: "x", unknown: { deep: true } }]]));
    expect(html).toBe("<table>\n<thead>\n<tr><th>x</th></tr>\n</thead>\n</table>\n");
  });
});

describe("vtableToMarkdown: header-only and formatted source", () => {
  it("renders a table with only a header row", () => {
    expect(vtableToMarkdown(table([[{ t: "h1" }, { t: "h2" }]]))).toBe(
      "<table>\n<thead>\n<tr><th>h1</th><th>h2</th></tr>\n</thead>\n</table>\n",
    );
  });

  it("accepts source formatted across lines, as Obsidian stores it", () => {
    const source = `{
      "rows": [
        [{"t": "h"}],
        [{"t": "b"}]
      ]
    }`;
    expect(vtableToMarkdown(source)).toContain("<td>b</td>");
  });
});
