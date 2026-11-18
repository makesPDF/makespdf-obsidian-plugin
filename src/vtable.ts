/**
 * The Vtable adapter: a `vtable` fenced block to an HTML `<table>`.
 *
 * Vtable (https://community.obsidian.md/plugins/vtable, MIT) is a third-party
 * Obsidian plugin that draws tables from one JSON object in a fenced block.
 * The engine never learns that format (decision 2026-10-30, see the makesPDF
 * repo's `docs/obsidian-plugin-formats.md`): this module translates it at the
 * edge into standard HTML, which the engine already renders (MAK-343).
 *
 * The JSON shape, as documented in that plan:
 *
 *     {
 *       "rows": [[cell, ...], ...],   // the first row is the header
 *       "style": "three" | "hline" | "noline" | "off",
 *       "zebra": boolean, "noHeaderBg": boolean,
 *       "colWidths": [number, ...]
 *     }
 *
 * A cell holds `t` (markdown text, with inline HTML), `rs`/`cs` (row and
 * column spans), `a`/`va` (horizontal and vertical alignment), `bg`
 * (background colour), and `f` (a formula; a `t` beginning with `=` and
 * shaped like one is accepted too). A cell covered by a merge is a
 * placeholder with `rs: 0, cs: 0`; it is skipped, because the anchor cell's
 * `rowspan`/`colspan` already covers it.
 *
 * What maps, and what cannot:
 * - `rs`/`cs`       -> `rowspan`/`colspan`
 * - `a`/`va`        -> `align`/`valign`
 * - `bg`            -> `style="background-color: ..."` (only colour values)
 * - first row       -> `<thead>` with `<th>`
 * - `style`         -> `<!-- borderless -->` for "noline"/"off"; "three" and
 *                      "hline" are already the PDF's default table borders
 * - `zebra`, `noHeaderBg` are theme choices in the PDF and have no per-table
 *   directive, so they are not represented
 * - `colWidths` is a hint at most (the user's own phone ignores it), so
 *   columns size to content; the value is not used
 * - formulas        -> computed values by this adapter (vtable-formula.ts)
 * - charts, diagonal split cells, inline `$math$` -> text plus one note under
 *   the table, since the PDF has no equivalent
 *
 * Invalid JSON, or JSON whose shape is not a table, returns null: the block is
 * left exactly as written and prints as a code block.
 *
 * Kept free of the `obsidian` import and unit-tested directly (see
 * vtable.test.ts).
 */

import { evaluateFormula, formatFormulaValue, type CellReader } from "./vtable-formula";

/** The info-string name of a Vtable block. */
export const VTABLE_FENCE = "vtable";

/** Guards against turning a pathological block into a huge request. */
const MAX_ROWS = 500;
const MAX_CELLS = 5_000;
/** The engine accepts at most three span digits. */
const MAX_SPAN = 999;

/** A cell as far as this adapter cares: unknown keys are ignored. */
interface VtableCell {
  [key: string]: unknown;
}

/** A parsed vtable table. */
interface VtableTable {
  rows: VtableCell[][];
  style?: string;
}

/** A coordinate in the raw `rows` grid. */
interface Point {
  row: number;
  column: number;
}

/** Chart cell kinds Vtable documents. */
const CHART_KINDS = ["vbarchart", "vpie", "vline"] as const;

/** The inline tags a cell's text may keep; other tags are escaped. */
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

/** True for a plain object (`{}` or `Object.create(null)`). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Turn one `rows` entry into cells, or null when the grid is malformed. */
function parseRows(raw: unknown): VtableCell[][] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_ROWS) return null;

  const rows: VtableCell[][] = [];
  let cells = 0;
  for (const rawRow of raw) {
    if (!Array.isArray(rawRow)) return null;
    const row: VtableCell[] = [];
    for (const rawCell of rawRow) {
      if (!isRecord(rawCell)) return null;
      row.push(rawCell);
      cells++;
      if (cells > MAX_CELLS) return null;
    }
    rows.push(row);
  }
  return rows;
}

/** A span value: a positive integer, 0 for a covered placeholder, 1 otherwise. */
function spanOf(cell: VtableCell, key: "rs" | "cs"): number {
  const value = cell[key];
  const number =
    typeof value === "number" && Number.isFinite(value)
      ? Math.trunc(value)
      : typeof value === "string" && /^\d+$/.test(value.trim())
        ? parseInt(value.trim(), 10)
        : 1;
  if (number <= 0) return 0;
  return Math.min(number, MAX_SPAN);
}

/** A placeholder is covered by another cell's span and draws nothing itself. */
function isPlaceholder(cell: VtableCell): boolean {
  return spanOf(cell, "rs") === 0 || spanOf(cell, "cs") === 0;
}

/** The cell's text, or "" for anything that is not a string. */
function cellText(cell: VtableCell): string {
  return typeof cell.t === "string" ? cell.t : "";
}

/**
 * The cell's formula, or null. Vtable stores a formula in the cell rather
 * than a value; the field is `f` (also accepted as `formula`), and a `t` that
 * begins with `=` and looks like a formula is accepted too, so a block
 * written either way is calculated.
 */
function formulaOf(cell: VtableCell): string | null {
  for (const key of ["f", "formula"] as const) {
    const value = cell[key];
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  const text = cellText(cell).trim();
  // A function call, a cell reference, a number or a leading operator; plain
  // prose that happens to start with "=" is not treated as a formula.
  if (/^=\s*(?:[A-Za-z]+\s*\(|[A-Za-z]+\d+|[-+(]|\d)/.test(text)) return text;
  return null;
}

/** The chart kind a cell describes, or null when it is not a chart. */
function chartKind(cell: VtableCell): string | null {
  for (const kind of CHART_KINDS) {
    if (cell[kind] !== undefined) return kind;
  }
  const chart = cell.chart;
  if (typeof chart === "string" && chart.trim() !== "") return chart;
  if (isRecord(chart)) {
    const type = chart.type;
    if (typeof type === "string" && type.trim() !== "") return type;
    return "chart";
  }
  if (chart !== undefined) return "chart";
  const type = cell.type;
  if (
    typeof type === "string" &&
    (CHART_KINDS as readonly string[]).includes(type.toLowerCase())
  ) {
    return type;
  }
  return null;
}

/** True when the cell describes a diagonal split cell. */
function isDiagonal(cell: VtableCell): boolean {
  return cell.diag !== undefined || cell.diagonal !== undefined;
}

/** The diagonal split cell as text: its own text, or the halves joined. */
function diagonalText(cell: VtableCell): string {
  const own = cellText(cell);
  if (own.trim() !== "") return own;
  const value = cell.diag ?? cell.diagonal;
  if (typeof value === "string") return value;
  if (isRecord(value)) {
    const parts = Object.values(value).filter(
      (part): part is string => typeof part === "string" && part.trim() !== "",
    );
    return parts.join(" / ");
  }
  return "";
}

/** Horizontal alignment values Vtable has used, mapped to HTML's `align`. */
const HORIZONTAL: Record<string, "center" | "right"> = {
  c: "center",
  m: "center",
  center: "center",
  centre: "center",
  middle: "center",
  r: "right",
  right: "right",
};

/** Vertical alignment values, mapped to HTML's `valign`. */
const VERTICAL: Record<string, "middle" | "bottom"> = {
  m: "middle",
  c: "middle",
  center: "middle",
  centre: "middle",
  middle: "middle",
  b: "bottom",
  bottom: "bottom",
};

/** A colour this adapter will put in a style attribute, or undefined. */
function cssColor(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const colour = value.trim();
  if (/^#[0-9a-f]{3}$/i.test(colour) || /^#[0-9a-f]{6}$/i.test(colour)) return colour;
  if (/^rgba?\([^)]*\)$/i.test(colour)) return colour;
  if (/^[a-z]+$/i.test(colour)) return colour;
  return undefined;
}

/** Escape a value for a double-quoted HTML attribute. */
function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Turn a cell's markdown text into table-cell HTML: line breaks, safe `<`. */
function renderText(text: string): string {
  return escapeStrayAngles(text).replace(/\r?\n/g, "<br>");
}

/**
 * Escape `<` unless it begins something tag-shaped. Inline HTML is part of
 * vtable's cell text, so `<b>bold</b>` stays; `a < b` and `x<y` become text.
 * Structural table tags are escaped so a literal `</td>` in the text cannot
 * break the table.
 */
function escapeStrayAngles(text: string): string {
  const escapedStructural = text.replace(
    /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:[^<>])*)>/g,
    (match, _slash: string, name: string) =>
      STRUCTURAL_TAGS.has(name.toLowerCase()) ? `&lt;${match.slice(1)}` : match,
  );
  return escapedStructural.replace(/<(?![a-zA-Z][^<>]*>|\/[a-zA-Z][^<>]*>)/g, "&lt;");
}

/** Format a number for display without floating-point noise. */
function formatNumber(value: number): string {
  return formatFormulaValue(value);
}

/** A number from a cell's text, or null when it is not one. */
function numberOfText(text: string): number | null {
  const trimmed = text.trim().replace(/,/g, "");
  if (!/^[-+]?(?:\d+\.?\d*|\.\d+)$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

/**
 * The display grid: for every raw coordinate, the anchor cell that draws it.
 * A placeholder, or any cell covered by a span, resolves to its anchor so a
 * formula can reference a merged cell by any of the cells it covers.
 */
function anchorGrid(rows: VtableCell[][]): (Point | null)[][] {
  const anchors: (Point | null)[][] = rows.map((row) => row.map(() => null));

  for (let row = 0; row < rows.length; row++) {
    for (let column = 0; column < rows[row].length; column++) {
      const cell = rows[row][column];
      if (isPlaceholder(cell)) continue;
      const rowSpan = spanOf(cell, "rs");
      const columnSpan = spanOf(cell, "cs");
      for (let dr = 0; dr < rowSpan; dr++) {
        for (let dc = 0; dc < columnSpan; dc++) {
          const targetRow = row + dr;
          const targetColumn = column + dc;
          if (targetRow < rows.length && targetColumn < rows[targetRow].length) {
            anchors[targetRow][targetColumn] = { row, column };
          }
        }
      }
    }
  }

  return anchors;
}

/** The rendered table, its formulas computed, and the notes for dropped extras. */
interface RenderedTable {
  html: string;
  notes: string[];
}

/**
 * Translate a `vtable` block's source into an HTML table, or null when the
 * source is not a vtable table (it then stays a code block).
 */
export function vtableToMarkdown(source: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;

  const rows = parseRows(parsed.rows);
  if (rows === null) return null;

  const table: VtableTable = {
    rows,
    ...(typeof parsed.style === "string" ? { style: parsed.style } : {}),
  };

  const rendered = renderTable(table);
  if (rendered === null) return null;

  const borderless = table.style !== undefined &&
    ["noline", "off"].includes(table.style.trim().toLowerCase());
  const parts: string[] = [];
  if (borderless) parts.push("<!-- borderless -->");
  parts.push(rendered.html);
  if (rendered.notes.length > 0) {
    parts.push("");
    parts.push(`> Note: ${rendered.notes.join("; ")}.`);
  }
  return `${parts.join("\n")}\n`;
}

/** Render the rows, or null when there is nothing a reader could see. */
function renderTable(table: VtableTable): RenderedTable | null {
  const { rows } = table;
  const anchors = anchorGrid(rows);
  const computing = new Set<string>();
  const computed = new Map<string, number | null>();

  /** The numeric value of a cell, computing formulas on demand. */
  const numericValue = (row: number, column: number): number | null => {
    if (row < 0 || row >= rows.length) return null;
    if (column < 0 || column >= rows[row].length) return null;

    const anchor = anchors[row][column];
    if (anchor === null) return null;
    const cell = rows[anchor.row][anchor.column];
    const formula = formulaOf(cell);
    if (formula === null) return numberOfText(cellText(cell));

    const key = `${anchor.row},${anchor.column}`;
    if (computing.has(key)) return null; // circular reference: fail the formula

    const cached = computed.get(key);
    if (cached !== undefined) return cached;

    computing.add(key);
    const read: CellReader = (targetRow, targetColumn) =>
      numericValue(targetRow, targetColumn);
    const value = evaluateFormula(formula, read);
    computing.delete(key);
    computed.set(key, value);
    return value;
  };

  const notes = new Set<string>();

  /** A cell's displayed text, with its formula resolved when it has one. */
  const textFor = (row: number, column: number): string => {
    const cell = rows[row][column];
    const kind = chartKind(cell);
    if (kind !== null) {
      notes.add("charts are shown as text");
      const own = cellText(cell).trim();
      return own !== "" ? cellText(cell) : `[chart: ${kind}]`;
    }

    if (isDiagonal(cell)) {
      notes.add("diagonal split cells are shown as text");
      return diagonalText(cell);
    }

    const formula = formulaOf(cell);
    if (formula !== null) {
      const value = numericValue(row, column);
      if (value !== null) return formatNumber(value);
      notes.add("formulas that could not be calculated are shown as text");
      return formula;
    }

    const text = cellText(cell);
    if (/\$[^$\r\n]+\$/.test(text)) notes.add("math is shown as text");
    return text;
  };

  const renderCell = (row: number, column: number, tag: "th" | "td"): string => {
    const cell = rows[row][column];
    const attributes: string[] = [];

    const columnSpan = spanOf(cell, "cs");
    if (columnSpan > 1) attributes.push(`colspan="${columnSpan}"`);
    const rowSpan = spanOf(cell, "rs");
    if (rowSpan > 1) attributes.push(`rowspan="${rowSpan}"`);

    const horizontal = typeof cell.a === "string" ? HORIZONTAL[cell.a.trim().toLowerCase()] : undefined;
    if (horizontal !== undefined) attributes.push(`align="${horizontal}"`);
    const vertical = typeof cell.va === "string" ? VERTICAL[cell.va.trim().toLowerCase()] : undefined;
    if (vertical !== undefined) attributes.push(`valign="${vertical}"`);

    const background = cssColor(cell.bg);
    if (background !== undefined) {
      attributes.push(`style="background-color: ${escapeAttribute(background)}"`);
    }

    const open = attributes.length > 0 ? `<${tag} ${attributes.join(" ")}>` : `<${tag}>`;
    return `${open}${renderText(textFor(row, column))}</${tag}>`;
  };

  const renderRow = (row: number, tag: "th" | "td"): string => {
    const cells: string[] = [];
    for (let column = 0; column < rows[row].length; column++) {
      if (isPlaceholder(rows[row][column])) continue;
      cells.push(renderCell(row, column, tag));
    }
    return cells.length === 0 ? "" : `<tr>${cells.join("")}</tr>`;
  };

  const header = renderRow(0, "th");
  const bodyRows: string[] = [];
  for (let row = 1; row < rows.length; row++) {
    const rendered = renderRow(row, "td");
    if (rendered !== "") bodyRows.push(rendered);
  }

  if (header === "" && bodyRows.length === 0) return null;

  const html: string[] = ["<table>"];
  if (header !== "") html.push("<thead>", header, "</thead>");
  if (bodyRows.length > 0) html.push("<tbody>", ...bodyRows, "</tbody>");
  html.push("</table>");

  return { html: html.join("\n"), notes: [...notes] };
}
