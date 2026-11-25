/**
 * Escaping for text that must print verbatim.
 *
 * Two callers insert text a user wrote somewhere else into the exported
 * markdown: the note's own file name (note-title.ts) and an image embed's alt
 * text (preprocess.ts). Neither is markup, so neither may be rewritten by a
 * later pass. The text then passes through two rewriters:
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
 * Escaping is invisible wherever the character was not significant, so the
 * set is applied everywhere rather than case by case.
 */

/**
 * Characters that change what prints, escaped with a backslash for a markdown
 * context. See the module comment for why each one is here.
 */
export const VERBATIM_ESCAPE_RE = /[\\`*_[\]<>#=~%^&]/g;

/** Escape text so markdown prints it verbatim. */
export function escapeVerbatimText(text: string): string {
  return text.replace(VERBATIM_ESCAPE_RE, "\\$&");
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
const HTML_ATTRIBUTE_ESCAPE_RE = /[&"<>\\`*_[\]#=~%^]/g;

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

/** Escape text so an HTML attribute's value is the text as written. */
export function escapeHtmlAttribute(text: string): string {
  return text.replace(HTML_ATTRIBUTE_ESCAPE_RE, (char) => HTML_ATTRIBUTE_ESCAPES[char]);
}
