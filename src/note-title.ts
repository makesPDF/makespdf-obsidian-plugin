/**
 * The note's title, printed as a heading at the top of an exported note.
 *
 * Obsidian shows a note's file name as its "inline title" above the body, and
 * its own PDF export prints it. This plugin sent the name only as the PDF
 * `/Title` metadata (the `title` option), so the heading a user sees in
 * Obsidian never reached the page. `withNoteTitle` inserts it as an H1.
 *
 * Pure string work with no Obsidian import, so it can be unit tested directly
 * (see note-title.test.ts) — the same shape as properties.ts and preprocess.ts.
 */

import { splitFrontMatter } from "./properties";

/**
 * Characters that change what the title PRINTS, escaped with a backslash.
 *
 * The title is inserted into the note before two passes that can rewrite it:
 * the plugin's own `preprocessObsidian` (raw-string rules, not markdown), and
 * GFM. The set covers both:
 *
 * - `\` — a literal backslash in the name
 * - `` ` `` — inline code
 * - `*` `_` — emphasis
 * - `[` `]` — link and reference syntax; also, via `preprocessObsidian`'s
 *   raw-string rules, `[[wikilink]]` and `![[embed]]`
 * - `<` `>` — raw HTML
 * - `#` — the heading marker, and `preprocessObsidian`'s `#tag` rule
 * - `=` — `preprocessObsidian`'s `==highlight==` rule
 * - `~` — GFM strikethrough
 * - `%` — `preprocessObsidian` strips `%%comments%%`, which silently deleted
 *   everything between two `%%` in a name
 * - `^` — `preprocessObsidian` strips a trailing ` ^block-id`
 * - `&` — entity decoding (`&amp;` in a name would print as `&`)
 *
 * A name is a document, not a document's author, so the bar is that the file
 * name prints VERBATIM. Escaping is invisible wherever the character was not
 * significant, so the set is applied everywhere rather than case by case.
 *
 * Known and accepted: GFM autolinks a bare `www.example.com`, so such a name
 * becomes a link in the heading. It is left alone deliberately — unlike every
 * character above, it does not change the text that prints. A literal `.` in
 * every file name is not worth escaping to remove a link.
 */
const TITLE_ESCAPE_RE = /[\\`*_[\]<>#=~%^&]/g;

/**
 * The title as a markdown H1, or `""` when there is no title to print.
 *
 * Whitespace is collapsed because a heading cannot span lines — a file name
 * cannot contain a newline, but the title also arrives from `file.basename`
 * and this keeps the function total.
 */
export function noteTitleHeading(title: string): string {
  const name = title.replace(/\s+/g, " ").trim();
  if (!name) return "";

  return `# ${name.replace(TITLE_ESCAPE_RE, "\\$&")}`;
}

/**
 * Insert the note's title as an H1 at the top of the note body.
 *
 * The insertion point is the first body character, so the title lands after any
 * YAML front matter (which must stay first, both for Obsidian and because the
 * API reads `title`/`author`/`lang` options out of it) and above anything else
 * already inserted there — the "Properties to include" table — matching the
 * order Obsidian's own reading view shows: inline title, properties, body.
 *
 * A note with no title, or a title that is only whitespace, is returned
 * unchanged.
 */
export function withNoteTitle(markdown: string, title: string): string {
  const heading = noteTitleHeading(title);
  if (!heading) return markdown;

  const { contentStart } = splitFrontMatter(markdown);
  const head = markdown.slice(0, contentStart);
  const body = markdown.slice(contentStart).replace(/^(?:\r?\n)+/, "");
  const before = head === "" || head.endsWith("\n") ? head : `${head}\n`;

  // Match the note's own line ending rather than sprinkling LF into a CRLF
  // file (a note written on Windows). Rendering tolerates either, but a
  // payload with mixed endings is pointless noise in every future diff.
  const eol = markdown.includes("\r\n") ? "\r\n" : "\n";

  return `${before}${heading}${eol}${eol}${body}`;
}
