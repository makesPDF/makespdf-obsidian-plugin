/**
 * Escaping for text that must print verbatim.
 *
 * Two callers insert text a user wrote somewhere else into the exported
 * markdown: the note's own file name (note-title.ts) and an image embed's alt
 * text and destination (preprocess.ts). None of it is markup, so none of it
 * may be rewritten by a later pass. The text then passes through two
 * rewriters:
 *
 * - the plugin's own `preprocessObsidian`, whose rules are raw-string
 *   replacements, not markdown;
 * - the API's markdown pass (GFM), which turns inline syntax into structure.
 *
 * {@link VERBATIM_ESCAPE_RE} covers both. Each character changes what PRINTS:
 *
 * - `\` — a literal backslash
 * - `` ` `` — inline code
 * - `*` `_` — emphasis
 * - `[` `]` — link and reference syntax; also, via `preprocessObsidian`'s
 *   raw-string rules, `[[wikilink]]` and `![[embed]]`
 * - `<` `>` — raw HTML
 * - `#` — the heading marker, and `preprocessObsidian`'s `#tag` rule
 * - `=` — `preprocessObsidian`'s `==highlight==` rule
 * - `~` — GFM strikethrough
 * - `%` — `preprocessObsidian` strips `%%comments%%`, which silently deletes
 *   everything between two `%%`
 * - `^` — `preprocessObsidian` strips a trailing ` ^block-id`
 * - `&` — entity decoding (`&amp;` would print as `&`)
 *
 * Where the text is inserted decides which of these can reach it. The note
 * title is inserted before `preprocessObsidian` runs, so every character above
 * matters to it. An image alt is inserted by the pass itself, after the
 * comment and block-id rules have run, so `%` and `^` cannot affect an alt
 * there; they stay in the set because the note title shares this one escaper
 * and needs them.
 *
 * Escaping is invisible wherever the character was not significant, so the
 * set is applied everywhere rather than case by case.
 */

/**
 * Characters that change what prints, escaped with a backslash for a markdown
 * context. See the module comment for why each one is here.
 */
export const VERBATIM_ESCAPE_RE = /[\\`*_[\]<>#=~%^&]/g;

/**
 * The same set as a character-class body, taken from the regex source so the
 * escaper and {@link unescapeVerbatimText} cannot drift apart.
 */
const VERBATIM_ESCAPE_SET = VERBATIM_ESCAPE_RE.source.slice(1, -1);

const VERBATIM_UNESCAPE_RE = new RegExp(String.raw`\\([${VERBATIM_ESCAPE_SET}])`, "g");

/** Escape text so markdown prints it verbatim. */
export function escapeVerbatimText(text: string): string {
  return text.replace(VERBATIM_ESCAPE_RE, "\\$&");
}

/**
 * Undo {@link escapeVerbatimText}: `\=` becomes `=`, `\\` becomes `\`.
 *
 * Only for a string this module escaped, such as an image destination between
 * angle brackets — it is how the inliner recovers the vault path to look up.
 */
export function unescapeVerbatimText(text: string): string {
  return text.replace(VERBATIM_UNESCAPE_RE, "$1");
}

/**
 * Characters that change what prints, written as HTML character references.
 *
 * Inside an HTML attribute a backslash is not an escape: `alt="a\"b"` ends the
 * value at the quote, and `alt="a\=b"` prints the backslash. So the same
 * verbatim set is written as character references instead. The HTML parser
 * hands the character back, and `preprocessObsidian`'s raw-string rules never
 * see it — an encoded `[` cannot open a wikilink and an encoded `=` cannot
 * become a highlight. `"` joins the set because it delimits the attribute, and
 * `<` `>` cannot appear raw inside a tag at all.
 */
const HTML_ATTRIBUTE_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  '"': "&quot;",
  "<": "&lt;",
  ">": "&gt;",
  "\\": "&#92;",
  "`": "&#96;",
  "*": "&#42;",
  "_": "&#95;",
  "[": "&#91;",
  "]": "&#93;",
  "#": "&#35;",
  "=": "&#61;",
  "~": "&#126;",
  "%": "&#37;",
  "^": "&#94;",
};

/**
 * The characters {@link escapeHtmlAttribute} encodes. Exported so a test can
 * check that every match has a mapping — a character in this class but not in
 * the map makes `replace` insert the literal text `undefined`.
 */
export const HTML_ATTRIBUTE_ESCAPE_RE = /[&"<>\\`*_[\]#=~%^]/g;

/** The map reversed, derived so the two directions cannot disagree. */
const HTML_ATTRIBUTE_UNESCAPES: Record<string, string> = Object.fromEntries(
  Object.entries(HTML_ATTRIBUTE_ESCAPES).map(([char, reference]) => [reference, char]),
);

const HTML_ATTRIBUTE_UNESCAPE_RE = new RegExp(
  `(?:${Object.keys(HTML_ATTRIBUTE_UNESCAPES).join("|")})`,
  "g",
);

/** Escape text so an HTML attribute's value is the text as written. */
export function escapeHtmlAttribute(text: string): string {
  return text.replace(HTML_ATTRIBUTE_ESCAPE_RE, (char) => HTML_ATTRIBUTE_ESCAPES[char]);
}

/**
 * Undo {@link escapeHtmlAttribute}, for a value this module encoded: an
 * `<img src="…">` path is encoded in the tag and must be decoded before the
 * inliner can resolve the file it names.
 */
export function unescapeHtmlAttribute(text: string): string {
  return text.replace(HTML_ATTRIBUTE_UNESCAPE_RE, (reference) => HTML_ATTRIBUTE_UNESCAPES[reference]);
}
