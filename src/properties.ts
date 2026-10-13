/**
 * Front matter property whitelisting for PDF export.
 *
 * Pure string and value transforms with no Obsidian imports, so they can be
 * unit tested directly (see properties.test.ts). The YAML itself is parsed by
 * Obsidian's `parseYaml` in main.ts; this module only locates the front matter
 * block (`getFrontMatterInfo` is `@since 1.5.7`, past this plugin's
 * `minAppVersion` of 1.4.0) and renders the selected properties.
 */

/** Where a note's YAML front matter block sits. */
export interface FrontMatterSplit {
  /** Whether the note opens with a `---` front matter block. */
  exists: boolean;
  /** Raw YAML between the opening and closing `---` lines. */
  frontmatter: string;
  /** Offset of the first body character, just past the closing `---` line. */
  contentStart: number;
}

const OPEN_RE = /^---[ \t]*\r?\n/;
const CLOSE_RE = /^---[ \t]*\r?(?:\r?\n|$)/m;

/**
 * Split the note at its front matter block. Matches Obsidian's own rules: the
 * block must open with `---` on the first line and closes at the next line
 * that is exactly `---` (allowing trailing whitespace). A note with no block,
 * or an unterminated one, is all body.
 */
export function splitFrontMatter(markdown: string): FrontMatterSplit {
  const open = OPEN_RE.exec(markdown);
  if (!open) return { exists: false, frontmatter: "", contentStart: 0 };

  const rest = markdown.slice(open[0].length);
  const close = CLOSE_RE.exec(rest);
  if (!close) return { exists: false, frontmatter: "", contentStart: 0 };

  return {
    exists: true,
    frontmatter: rest.slice(0, close.index),
    contentStart: open[0].length + close.index + close[0].length,
  };
}

/** A parsed "Properties to include" setting. */
export interface PropertyWhitelist {
  /** Named properties, in the order given, with the case the user typed. */
  names: string[];
  /** Whether `*` appeared: also print every other property, in note order. */
  includeAll: boolean;
}

/**
 * Parse the comma-separated whitelist. Entries are trimmed; blank entries and
 * case-insensitive duplicates are dropped. `*` is not a name but the flag that
 * pulls in every property the note has.
 */
export function parsePropertyWhitelist(value: string): PropertyWhitelist {
  const names: string[] = [];
  const seen = new Set<string>();
  let includeAll = false;

  for (const part of value.split(",")) {
    const name = part.trim();
    if (!name) continue;
    if (name === "*") {
      includeAll = true;
      continue;
    }
    const lower = name.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    names.push(name);
  }

  return { names, includeAll };
}

/** Turn wikilinks into their display text, as preprocessObsidian would. */
function wikilinkDisplayText(value: string): string {
  // Done here rather than relying on preprocessObsidian, because the `|` in
  // `[[Note|Alias]]` would otherwise break the table before preprocessing runs.
  return value.replace(/\[\[([^\]]+?)\]\]/g, (_match, inner: string) => {
    const pipe = inner.indexOf("|");
    if (pipe >= 0) return inner.slice(pipe + 1);
    const hash = inner.indexOf("#");
    if (hash >= 0) return inner.slice(hash + 1);
    return inner;
  });
}

/**
 * Dates as written: YAML turns an unquoted date into a Date at UTC midnight,
 * which prints back as the plain date. A date with a time prints as UTC.
 */
function formatDate(value: Date): string {
  const iso = value.toISOString();
  if (iso.endsWith("T00:00:00.000Z")) return iso.slice(0, 10);
  const time = iso.slice(11, 19);
  const trimmed = time.endsWith(":00") ? time.slice(0, -3) : time;
  return `${iso.slice(0, 10)} ${trimmed} UTC`;
}

/**
 * A display string for one property value, or null when there is nothing to
 * print: null, empty strings and empty collections are skipped. Text and
 * numbers print as-is, booleans as Yes/No, lists joined with ", ", wikilinks
 * as their display text, and nested objects as compact `key: value` pairs.
 * A cyclic value (a self-referential YAML alias) prints nothing rather than
 * recursing forever. The result is not yet table-escaped; buildPropertyTable
 * does that.
 */
export function formatPropertyValue(value: unknown): string | null {
  return formatValue(value, new WeakSet<object>());
}

/**
 * The recursive body of formatPropertyValue. `seen` holds the containers on
 * the current path, so a cycle is skipped while a value re-used in two
 * sibling positions still prints in both.
 */
function formatValue(value: unknown, seen: WeakSet<object>): string | null {
  if (value === null || value === undefined) return null;

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? null : wikilinkDisplayText(trimmed);
  }
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (value instanceof Date) return formatDate(value);

  if (Array.isArray(value)) {
    if (seen.has(value)) return null;
    seen.add(value);
    const parts = value
      .map((entry) => formatValue(entry, seen))
      .filter((part): part is string => part !== null);
    seen.delete(value);
    return parts.length > 0 ? parts.join(", ") : null;
  }

  if (typeof value === "object") {
    if (seen.has(value)) return null;
    seen.add(value);
    const parts = Object.entries(value as Record<string, unknown>)
      .map(([key, entry]) => {
        const formatted = formatValue(entry, seen);
        return formatted === null ? null : `${key}: ${formatted}`;
      })
      .filter((part): part is string => part !== null);
    seen.delete(value);
    return parts.length > 0 ? parts.join(", ") : null;
  }

  // YAML data never reaches here with anything but a bigint; anything else
  // (a function, a symbol) has no printable form.
  return typeof value === "bigint" ? value.toString() : null;
}

/**
 * Make a string safe for one GFM table cell: backslashes and pipes escaped,
 * newlines collapsed to spaces. Escaping backslashes first stops a literal
 * `\` in the value from swallowing the pipe escape.
 */
export function escapeTableCell(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/[\r\n]+/g, " ");
}

/** True for a `parseYaml` result that can hold properties. */
function isPropertiesObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Build the `<!-- borderless -->` key/value table for the whitelisted
 * properties, or "" when the whitelist is empty or nothing matches. Named
 * properties print first, in whitelist order; `*` appends every other
 * property in note order. Names are matched case-insensitively; keys print as
 * written in the note. `properties` is Obsidian's parsed front matter.
 */
export function buildPropertyTable(properties: unknown, whitelist: string): string {
  const { names, includeAll } = parsePropertyWhitelist(whitelist);
  if (!isPropertiesObject(properties)) return "";

  const keys = Object.keys(properties);
  const keyByLower = new Map<string, string>();
  for (const key of keys) {
    const lower = key.toLowerCase();
    if (!keyByLower.has(lower)) keyByLower.set(lower, key);
  }

  const selected: string[] = [];
  const used = new Set<string>();
  const push = (key: string) => {
    if (used.has(key)) return;
    used.add(key);
    selected.push(key);
  };

  for (const name of names) {
    const key = keyByLower.get(name.toLowerCase());
    if (key !== undefined) push(key);
  }
  if (includeAll) for (const key of keys) push(key);

  const rows = selected.flatMap((key) => {
    const formatted = formatPropertyValue(properties[key]);
    if (formatted === null) return [];
    return [`| ${escapeTableCell(key)} | ${escapeTableCell(formatted)} |`];
  });
  if (rows.length === 0) return "";

  return [
    "<!-- borderless -->",
    "| Property | Value |",
    "| --- | --- |",
    ...rows,
  ].join("\n");
}

/**
 * Insert the table directly after the front matter block (or at the top of a
 * note without one), leaving the front matter itself untouched so the server
 * still reads its option keys. Returns the markdown unchanged for an empty
 * table.
 */
export function insertPropertyTable(
  markdown: string,
  contentStart: number,
  table: string,
): string {
  if (!table) return markdown;

  const head = markdown.slice(0, contentStart);
  const body = markdown.slice(contentStart).replace(/^(?:\r?\n)+/, "");
  const before = head === "" || head.endsWith("\n") ? head : `${head}\n`;

  return `${before}${table}${body ? "\n\n" : "\n"}${body}`;
}
