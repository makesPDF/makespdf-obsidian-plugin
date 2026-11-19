/**
 * Finding fenced code blocks in markdown.
 *
 * Two callers need the same line rules: the adapter registry replaces a
 * matching block with its translated output, and `preprocessObsidian` must
 * leave the inside of every block alone (a `#tag` or `[[wikilink]]` shown as
 * code is not Obsidian syntax to convert). Kept free of the `obsidian` import
 * and unit-tested directly (see fenced-blocks.test.ts).
 *
 * The rules follow CommonMark where it matters here: a fence is three or more
 * backticks or tildes, indented by at most three spaces; a closing fence uses
 * the same character, is at least as long, and carries nothing but whitespace;
 * an unclosed fence runs to the end of the document.
 *
 * A fence inside a blockquote or callout (`> ``` `) or indented four or more
 * spaces inside a list item is out of scope: its line starts with `>` or with
 * too much indentation, so it is not found here, which means callers neither
 * translate it nor protect its contents. The YAML front matter is skipped:
 * the engine strips it before rendering, and a fence in a block scalar there
 * must not open a block over the note body.
 */

import { splitFrontMatter } from "./properties";

/** A fenced code block found in markdown, with offsets and its info string. */
export interface FencedBlock {
  /** Offset of the opening fence line's first character. */
  from: number;
  /** Offset just past the closing fence line (including its newline), or the document end. */
  to: number;
  /** Whitespace before the opening fence: zero to three spaces. */
  indent: string;
  /** The fence's info string, trimmed, e.g. `vtable` or `js title="a.js"`. */
  info: string;
  /** The first word of the info string, lower-cased; empty for a bare fence. */
  fence: string;
  /** The block's content, without its fence lines. */
  source: string;
}

/** An opening fence line: up to three spaces, three or more backticks or tildes. */
const OPENING_FENCE = /^( {0,3})(`{3,}|~{3,})(.*)$/;

/** A closing fence line: the same shape, with nothing but whitespace after it. */
const CLOSING_FENCE = /^( {0,3})(`{3,}|~{3,})\s*$/;

/** The first word of an info string, lower-cased, or "". */
function fenceName(rest: string): string {
  const info = rest.trim();
  if (info === "") return "";
  const word = info.split(/\s+/, 1)[0];
  return word.toLowerCase();
}

/**
 * Find every fenced code block in `markdown`, in document order.
 *
 * The scan is linear: each line is examined once.
 */
export function scanFencedBlocks(markdown: string): FencedBlock[] {
  const blocks: FencedBlock[] = [];
  // The front matter is not note body: a fence in a YAML block scalar there
  // must not open a code block over the body (the engine strips it anyway).
  const { exists, contentStart } = splitFrontMatter(markdown);
  let lineStart = exists ? contentStart : 0;

  while (lineStart < markdown.length) {
    const newline = markdown.indexOf("\n", lineStart);
    const lineEnd = newline === -1 ? markdown.length : newline;
    // Match without the CR so a CRLF document's fence lines are recognised;
    // the offsets still come from the raw text.
    const line = markdown.slice(lineStart, lineEnd).replace(/\r$/, "");
    const opening = OPENING_FENCE.exec(line);

    if (!opening) {
      lineStart = newline === -1 ? markdown.length : newline + 1;
      continue;
    }

    const indent = opening[1];
    const marker = opening[2];
    const rest = opening[3];
    const char = marker[0];

    // A backtick fence's info string cannot hold a backtick; such a line is
    // ordinary text (or an inline-code run), not a fence.
    if (char === "`" && rest.includes("`")) {
      lineStart = newline === -1 ? markdown.length : newline + 1;
      continue;
    }

    const contentStart = newline === -1 ? markdown.length : newline + 1;
    let scan = contentStart;
    let contentEnd = markdown.length;
    let blockEnd = markdown.length;
    let closed = false;

    while (scan < markdown.length) {
      const nextNewline = markdown.indexOf("\n", scan);
      const nextLineEnd = nextNewline === -1 ? markdown.length : nextNewline;
      const candidate = markdown.slice(scan, nextLineEnd).replace(/\r$/, "");
      const closing = CLOSING_FENCE.exec(candidate);

      if (
        closing &&
        closing[2][0] === char &&
        closing[2].length >= marker.length
      ) {
        contentEnd = scan;
        blockEnd = nextNewline === -1 ? markdown.length : nextNewline + 1;
        closed = true;
        break;
      }

      scan = nextNewline === -1 ? markdown.length : nextNewline + 1;
    }

    blocks.push({
      from: lineStart,
      to: blockEnd,
      indent,
      info: rest.trim(),
      fence: fenceName(rest),
      source: markdown.slice(contentStart, contentEnd),
    });

    lineStart = blockEnd;
    if (!closed) break;
  }

  return blocks;
}

/** What {@link replaceFencedBlocks} puts in a block's place: null keeps it. */
export type FencedBlockReplacer = (block: FencedBlock) => string | null;

/**
 * Rewrite every fenced block through `replace`, leaving the rest of the
 * document byte-for-byte unchanged. A null return keeps the block as it was.
 */
export function replaceFencedBlocks(
  markdown: string,
  replace: FencedBlockReplacer,
): string {
  const blocks = scanFencedBlocks(markdown);
  if (blocks.length === 0) return markdown;

  let out = "";
  let cursor = 0;
  for (const block of blocks) {
    out += markdown.slice(cursor, block.from);
    const replacement = replace(block);
    out += replacement === null ? markdown.slice(block.from, block.to) : replacement;
    cursor = block.to;
  }
  return out + markdown.slice(cursor);
}

/**
 * Prefix every non-empty line of `text` with `indent`, so a block translated
 * inside a list item keeps its nesting.
 */
export function indentLines(text: string, indent: string): string {
  if (indent === "") return text;
  return text
    .split("\n")
    .map((line) => (line === "" ? line : indent + line))
    .join("\n");
}
