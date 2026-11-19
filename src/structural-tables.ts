/**
 * The Structural Tables adapter: pipe tables with merge markers to an HTML
 * `<table>`.
 *
 * Structural Tables (https://github.com/ZHYX91/obsidian-structural-tables,
 * MIT, id `structural-tables`) extends GFM pipe tables with three markers:
 *
 * - `<` in a cell merges it with the previous source column (a `colspan`);
 * - `^` merges it upward into the cell above (a `rowspan`);
 * - `||` in the delimiter row adds no column, and marks the source columns
 *   before it as row headers.
 *
 * Rows above the delimiter row are column headers, and there can be several;
 * a table whose first line is the delimiter row has no column header. `\<`
 * and `\^` print literally.
 *
 * The engine never learns this format (MAK-343 / MAK-344, and the makesPDF
 * repo's `docs/obsidian-plugin-formats.md`): this module translates it at the
 * edge into the HTML table the engine already renders, with `colspan`,
 * `rowspan`, `<th>`, and the delimiter row's alignment as `align`.
 *
 * Merged areas must form a rectangle and cannot cross the header/data
 * boundary. A table that breaks either rule - or whose rows do not line up -
 * is left exactly as written, so it still prints as a GFM pipe table.
 *
 * Only tables that use a marker are translated: a `<` is legitimate content
 * in anybody else's table, so an ordinary GFM table stays untouched even
 * while the adapter is active. Activation itself is decided by the caller
 * (the Structural Tables plugin being enabled, or the adapter's setting), not
 * here. A row must have a leading and a trailing pipe, the form Structural
 * Tables writes; a table without a delimiter row, or with two, is not
 * translated.
 *
 * Cell content stays markdown. The adapter runs before `preprocessObsidian`,
 * so `[[wikilinks]]`, `![[image]]` embeds, highlights and tags inside the
 * generated cells are converted as usual. A `\|` in a cell is a literal pipe,
 * as it is in a GFM pipe table.
 *
 * Kept free of the `obsidian` import and unit-tested directly (see
 * structural-tables.test.ts).
 */

import { mapOutsideFencedBlocks } from "./fenced-blocks";
import { splitFrontMatter } from "./properties";

/** The Obsidian community-plugin id, and this adapter's settings key. */
export const STRUCTURAL_TABLES_PLUGIN_ID = "structural-tables";

/** The engine's own cap on an HTML table; a bigger block stays a pipe table. */
const MAX_CELLS = 5_000;

/** A line that is one source row: up to three spaces, then pipe-delimited. */
const PIPE_ROW = /^ {0,3}\|.*\|$/;

/** One delimiter cell: dashes with an optional colon on either side. */
const DELIMITER_CELL = /^:?-+:?$/;

/** HTML alignment values the delimiter row can ask for. */
type Align = "center" | "right";

/** What the delimiter row says about the columns below it. */
interface Delimiter {
  /** Number of source columns. The `||` divider adds none. */
  columns: number;
  /** Leading source columns that are row headers (`<th>` in a body row). */
  rowHeaders: number;
  /** Per-column horizontal alignment; `left` is HTML's default, so undefined. */
  align: (Align | undefined)[];
}

/** One cell of the source grid. */
interface SourceCell {
  kind: "anchor" | "left" | "up";
  text: string;
}

/** The span an anchor cell covers. */
interface Span {
  colspan: number;
  rowspan: number;
}

/** True when `line` is one pipe-delimited row. */
function isPipeRow(line: string): boolean {
  return PIPE_ROW.test(line.replace(/\r$/, "").trimEnd());
}

/**
 * Split a pipe row into its cells, trimmed. The leading and trailing pipes
 * are required by {@link isPipeRow}, so they only delimit the row. `\|` is a
 * literal pipe and does not split; it is unescaped when the cell is rendered.
 */
function splitRow(line: string): string[] {
  const trimmed = line.replace(/\r$/, "").trim();
  const cells: string[] = [];
  let cell = "";
  // Skip the leading pipe and stop before the trailing one.
  for (let index = 1; index < trimmed.length - 1; index++) {
    const character = trimmed[index];
    if (character === "\\" && trimmed[index + 1] === "|") {
      cell += "\\|";
      index++;
    } else if (character === "|") {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += character;
    }
  }
  cells.push(cell.trim());
  return cells;
}

/**
 * Read the delimiter row, or null when the line is not one. An empty cell is
 * the `||` divider, which marks the columns before it as row headers and adds
 * no column; more than one divider is ambiguous, so the table is not
 * translated.
 */
function parseDelimiter(line: string): Delimiter | null {
  const cells = splitRow(line);
  const align: (Align | undefined)[] = [];
  let divider = -1;

  for (let index = 0; index < cells.length; index++) {
    const cell = cells[index];
    if (cell === "") {
      if (divider !== -1) return null;
      divider = index;
      continue;
    }
    if (!DELIMITER_CELL.test(cell)) return null;
    if (cell.endsWith(":")) {
      align.push(cell.startsWith(":") ? "center" : "right");
    } else {
      align.push(undefined);
    }
  }

  if (align.length === 0) return null;
  return {
    columns: align.length,
    // The divider is the only empty cell, so every column before it is a
    // row-header column.
    rowHeaders: divider === -1 ? 0 : divider,
    align,
  };
}

/** Unescape the two literal marker spellings inside a cell's text. */
function unescapeMarker(text: string): string {
  return text
    .replace(/\\\|/g, "|")
    .replace(/\\</g, "<")
    .replace(/\\\^/g, "^");
}

/**
 * Turn one row into cells, or null when it has more cells than the delimiter
 * row defines. A short body row is padded with empty cells, as GFM pads a
 * short body row; a header row must line up exactly.
 */
function parseRow(line: string, columns: number, pad: boolean): SourceCell[] | null {
  const raw = splitRow(line);
  if (raw.length > columns) return null;
  if (!pad && raw.length !== columns) return null;

  const cells: SourceCell[] = raw.map((text) => {
    if (text === "<") return { kind: "left", text: "" };
    if (text === "^") return { kind: "up", text: "" };
    return { kind: "anchor", text: unescapeMarker(text) };
  });
  while (cells.length < columns) cells.push({ kind: "anchor", text: "" });
  return cells;
}

/** Inline HTML tags a cell may keep; the table's own tags are escaped. */
const STRUCTURAL_TAGS = new Set([
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "td",
  "th",
  "caption",
  "colgroup",
  "col",
]);

/**
 * Escape `<` unless it begins something tag-shaped. Cell content is markdown,
 * so inline HTML (`<b>bold</b>`, an autolink) stays, `a < b` and an escaped
 * `\<` become text, and a literal `</td>` cannot end the cell early.
 */
function escapeStrayAngles(text: string): string {
  const escapedStructural = text.replace(
    /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:[^<>])*)>/g,
    (match, _slash: string, name: string) =>
      STRUCTURAL_TAGS.has(name.toLowerCase()) ? `&lt;${match.slice(1)}` : match,
  );
  return escapedStructural.replace(/<(?![a-zA-Z][^<>]*>|\/[a-zA-Z][^<>]*>)/g, "&lt;");
}

/**
 * Work out every anchor's span, or null when the markers do not form
 * rectangles inside one header or body region.
 *
 * The extent is read from the source grid: an anchor's `colspan` is the run
 * of `<` cells to its right on the same row, and its `rowspan` is the run of
 * rows below where every cell under that colspan is `^`. Every `<` or `^`
 * must then end up covered by exactly one such rectangle.
 */
function buildSpans(rows: SourceCell[][], headerRows: number): (Span | null)[][] | null {
  const height = rows.length;
  const width = rows[0].length;
  const spans: (Span | null)[][] = rows.map((row) => row.map(() => null));
  const covered: boolean[][] = rows.map((row) => row.map(() => false));
  const isHeader = (row: number) => row < headerRows;

  // A merge marker needs a cell to merge into. Without these checks a `<` in
  // the first column or a `^` in the first row would silently be a blank cell.
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      const kind = rows[row][column].kind;
      if (kind === "left" && column === 0) return null;
      if (kind === "up" && row === 0) return null;
    }
  }

  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      if (rows[row][column].kind !== "anchor") continue;

      let colspan = 1;
      while (column + colspan < width && rows[row][column + colspan].kind === "left") {
        colspan++;
      }

      let rowspan = 1;
      while (row + rowspan < height) {
        // A merged area cannot cross the column-header / data boundary.
        if (isHeader(row) !== isHeader(row + rowspan)) break;
        let allUp = true;
        for (let offset = 0; offset < colspan; offset++) {
          if (rows[row + rowspan][column + offset].kind !== "up") {
            allUp = false;
            break;
          }
        }
        if (!allUp) break;
        rowspan++;
      }

      spans[row][column] = { colspan, rowspan };
      for (let down = 0; down < rowspan; down++) {
        for (let right = 0; right < colspan; right++) {
          if (down === 0 && right === 0) continue;
          // Two rectangles claiming one cell is not a rectangle.
          if (covered[row + down][column + right]) return null;
          covered[row + down][column + right] = true;
        }
      }
    }
  }

  // Every marker must be covered. A `<` always extends an anchor to its left,
  // so an uncovered one means the rectangle was cut short by content, and the
  // same for `^`.
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      if (rows[row][column].kind === "anchor") continue;
      if (!covered[row][column]) return null;
    }
  }

  return spans;
}

/** One cell as HTML, with its span and alignment. */
function renderCell(cell: SourceCell, span: Span, tag: "th" | "td", align: Align | undefined): string {
  const attributes: string[] = [];
  if (span.colspan > 1) attributes.push(`colspan="${span.colspan}"`);
  if (span.rowspan > 1) attributes.push(`rowspan="${span.rowspan}"`);
  if (align !== undefined) attributes.push(`align="${align}"`);

  const open = attributes.length > 0 ? `<${tag} ${attributes.join(" ")}>` : `<${tag}>`;
  return `${open}${escapeStrayAngles(cell.text)}</${tag}>`;
}

/**
 * Translate one block of consecutive pipe rows into HTML lines, or null to
 * leave it as a pipe table. `block` has no blank lines: the caller ends the
 * table at the first non-pipe line, as GFM does.
 */
function renderTable(block: string[]): string[] | null {
  const delimiters: number[] = [];
  for (let index = 0; index < block.length; index++) {
    if (parseDelimiter(block[index]) !== null) delimiters.push(index);
  }
  // A pipe block with no delimiter row is not a table. Two delimiter rows
  // would leave no unambiguous header column, so it is left alone too.
  if (delimiters.length !== 1) return null;

  const delimiterIndex = delimiters[0];
  const delimiter = parseDelimiter(block[delimiterIndex]);
  if (delimiter === null) return null;

  const headerSource = block.slice(0, delimiterIndex);
  const bodySource = block.slice(delimiterIndex + 1);
  if (headerSource.length === 0 && bodySource.length === 0) return null;

  const headerRows: SourceCell[][] = [];
  for (const line of headerSource) {
    const cells = parseRow(line, delimiter.columns, false);
    if (cells === null) return null;
    headerRows.push(cells);
  }

  const bodyRows: SourceCell[][] = [];
  for (const line of bodySource) {
    const cells = parseRow(line, delimiter.columns, true);
    if (cells === null) return null;
    bodyRows.push(cells);
  }

  const rows = [...headerRows, ...bodyRows];
  if (rows.length === 0) return null;
  if (rows.length * delimiter.columns > MAX_CELLS) return null;

  // Only a table that uses a marker is translated. `||` is a marker on its
  // own; without one, a plain GFM table is left exactly as written.
  const usesMarker =
    delimiter.rowHeaders > 0 ||
    rows.some((row) => row.some((cell) => cell.kind !== "anchor"));
  if (!usesMarker) return null;

  const spans = buildSpans(rows, headerRows.length);
  if (spans === null) return null;

  const renderRow = (rowIndex: number, header: boolean): string => {
    const cells: string[] = [];
    for (let column = 0; column < delimiter.columns; column++) {
      const cell = rows[rowIndex][column];
      if (cell.kind !== "anchor") continue;
      const span = spans[rowIndex][column];
      if (span === null) continue;
      const tag = header || column < delimiter.rowHeaders ? "th" : "td";
      cells.push(renderCell(cell, span, tag, delimiter.align[column]));
    }
    // A row every cell of which is covered by a span above draws nothing
    // itself; an empty `<tr>` is not emitted (the vtable adapter's rule).
    return cells.length === 0 ? "" : `<tr>${cells.join("")}</tr>`;
  };

  const headerLines: string[] = [];
  for (let row = 0; row < headerRows.length; row++) {
    const rendered = renderRow(row, true);
    if (rendered !== "") headerLines.push(rendered);
  }

  const bodyLines: string[] = [];
  for (let row = headerRows.length; row < rows.length; row++) {
    const rendered = renderRow(row, false);
    if (rendered !== "") bodyLines.push(rendered);
  }

  const html: string[] = ["<table>"];
  if (headerLines.length > 0) {
    html.push("<thead>", ...headerLines, "</thead>");
  }
  if (bodyLines.length > 0) {
    html.push("<tbody>", ...bodyLines, "</tbody>");
  }
  html.push("</table>");
  return html;
}

/**
 * Translate every structural pipe table in `text`, leaving every other byte
 * untouched. Split out from the fence walk so it is tested directly.
 */
export function convertStructuralTables(text: string): string {
  const lines = text.split("\n");
  const output: string[] = [];
  let index = 0;

  while (index < lines.length) {
    if (!isPipeRow(lines[index])) {
      output.push(lines[index]);
      index++;
      continue;
    }

    let end = index;
    while (end < lines.length && isPipeRow(lines[end])) end++;

    // A table indented inside a list item keeps its indentation on the HTML,
    // so the translated table stays in that item.
    const indent = /^ */.exec(lines[index])?.[0] ?? "";
    const rendered = renderTable(lines.slice(index, end));
    if (rendered === null) {
      output.push(...lines.slice(index, end));
    } else {
      output.push(...rendered.map((line) => (line === "" ? line : indent + line)));
      // A blank line ends the HTML block, so the line after the table cannot
      // join it (the same rule the vtable adapter follows). It also keeps a
      // following paragraph from being read as part of the table. The source
      // usually has a blank line there already; do not double it.
      if (end >= lines.length || lines[end].trim() !== "") output.push("");
    }
    index = end;
  }

  return output.join("\n");
}

/**
 * The adapter's whole-document transform. Fenced code is left byte for byte:
 * a pipe table shown as an example inside a fence is code, and a marker in
 * it is text the user chose to display. The YAML front matter is skipped too:
 * the server reads the note's properties from it, and a pipe table in a block
 * scalar there must not become HTML.
 */
export function structuralTablesToMarkdown(markdown: string): string {
  const { exists, contentStart } = splitFrontMatter(markdown);
  if (!exists) return mapOutsideFencedBlocks(markdown, convertStructuralTables);
  return (
    markdown.slice(0, contentStart) +
    mapOutsideFencedBlocks(markdown.slice(contentStart), convertStructuralTables)
  );
}
