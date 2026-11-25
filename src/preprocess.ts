/**
 * Obsidian-flavoured markdown to GFM conversion.
 *
 * Pure string transforms with no Obsidian imports, so they can be
 * unit tested directly (see preprocess.test.ts).
 */

import { MD_IMAGE_DEST, unwrapImageDest } from "./images";
import { scanFencedBlocks, type FencedBlock } from "./fenced-blocks";
import { escapeHtmlAttribute, escapeVerbatimText } from "./escaping";

/**
 * Map of Obsidian callout types to the closest GFM alert type.
 * Types not listed here default to NOTE.
 */
export const CALLOUT_MAP: Record<string, string> = {
  // Direct GFM equivalents
  note: "NOTE",
  tip: "TIP",
  hint: "TIP",
  important: "IMPORTANT",
  warning: "WARNING",
  attention: "WARNING",
  caution: "CAUTION",
  // Obsidian extras, mapped to the closest GFM match
  info: "NOTE",
  abstract: "NOTE",
  summary: "NOTE",
  tldr: "NOTE",
  todo: "NOTE",
  success: "TIP",
  check: "TIP",
  done: "TIP",
  question: "NOTE",
  help: "NOTE",
  faq: "NOTE",
  failure: "CAUTION",
  fail: "CAUTION",
  missing: "CAUTION",
  danger: "CAUTION",
  error: "CAUTION",
  bug: "CAUTION",
  example: "NOTE",
  quote: "NOTE",
  cite: "NOTE",
};

/** Options for {@link preprocessObsidian}. */
export interface PreprocessOptions {
  /**
   * Keep trailing ` ^block-id` markers instead of stripping them. Canvas
   * file nodes need them: the server resolves a card's `#^blockid` subpath
   * by looking for the marker in the note text, then strips it from the
   * block it renders. Note export leaves this off so the marker never
   * prints.
   */
  keepBlockIds?: boolean;
}

/**
 * Converts Obsidian-flavoured markdown to GFM-compatible markdown.
 *
 * Handles: wikilinks, image embeds with a size or alt text, highlights,
 * comments, block references, tags, callout titles/types, and image resize
 * syntax.
 *
 * The inside of a fenced code block is left exactly as written: a `#tag`,
 * `[[wikilink]]`, `==highlight==` or `%%comment%%` shown in a code block is
 * text the user chose to display as code, not Obsidian syntax. An adapter
 * translated its block before the note-level pass, so a translated block is
 * ordinary markdown or HTML by the time these rules see it. This holds for a
 * fence at the start of a line or indented up to three spaces; see
 * {@link ../fenced-blocks} for the callout and indented-list positions the
 * scanner does not find.
 *
 * A `%%...%%` comment is the one rule that can span a fence: a comment that
 * opens outside a code block hides the whole span, including a code block
 * written inside it. Markers shown inside a code block are still code, so
 * they never open or close a comment.
 */
export function preprocessObsidian(md: string, options: PreprocessOptions = {}): string {
  const blocks = scanFencedBlocks(md);
  if (blocks.length === 0) return obsidianToGfm(md, options);

  const comments = findCommentSpans(md, blocks);

  // Walk the block and comment ranges in document order: a comment is
  // removed, a block is kept byte for byte, and the text between them is
  // converted. A block inside a comment is removed with it.
  const ranges: { from: number; to: number; kind: "block" | "comment" }[] = [];
  for (const block of blocks) ranges.push({ from: block.from, to: block.to, kind: "block" });
  for (const comment of comments) {
    ranges.push({ from: comment.from, to: comment.to, kind: "comment" });
  }
  ranges.sort((a, b) => a.from - b.from);

  let result = "";
  let cursor = 0;
  for (const range of ranges) {
    const from = Math.max(range.from, cursor);
    if (from > cursor) result += obsidianToGfm(md.slice(cursor, from), options);
    if (range.to <= cursor) continue;
    if (range.kind === "block") {
      result += md.slice(from, range.to);
      cursor = range.to;
    } else {
      cursor = range.to;
    }
  }
  return result + obsidianToGfm(md.slice(cursor), options);
}

/** A character span to keep or drop, by its offsets in the document. */
interface TextSpan {
  from: number;
  to: number;
}

/**
 * Pair the `%%` markers that occur outside fenced code blocks, in order, as a
 * global comment rule would. A marker inside a fence is code and is ignored,
 * so it can neither open nor close a comment; an unmatched last marker is
 * left as text, as the comment rule always did.
 */
function findCommentSpans(markdown: string, blocks: FencedBlock[]): TextSpan[] {
  const markers: number[] = [];
  const collect = (from: number, to: number) => {
    let index = markdown.indexOf("%%", from);
    while (index !== -1 && index + 2 <= to) {
      markers.push(index);
      index = markdown.indexOf("%%", index + 2);
    }
  };

  let cursor = 0;
  for (const block of blocks) {
    collect(cursor, block.from);
    cursor = block.to;
  }
  collect(cursor, markdown.length);

  const spans: TextSpan[] = [];
  for (let index = 0; index + 1 < markers.length; index += 2) {
    spans.push({ from: markers[index], to: markers[index + 1] + 2 });
  }
  return spans;
}

/**
 * `![[image.png]]` and `![[image.png|display]]`, for the extensions Obsidian
 * renders as an image.
 *
 * The display text may hold a single `]`: Obsidian's own embed parser ends the
 * link at the first `]]`, so `![[a.png|see [1] here]]` is one embed. The alt
 * group is therefore "a character that is neither a bracket nor a newline, or
 * a bracket that does not close the link" — an unambiguous alternation, so it
 * cannot backtrack exponentially on an unterminated embed.
 */
const IMAGE_EMBED_RE = new RegExp(
  String.raw`!\[\[([^\]|]+\.(?:png|jpe?g|gif|svg|webp|bmp|avif))(?:\|((?:[^\]\n]|\](?!\]))*))?\]\]`,
  "gi",
);

/** Obsidian's image size: `300` or `300x200`, spaces allowed around the `x`. */
const IMAGE_SIZE_RE = /^(\d+)\s*(?:x\s*(\d+))?$/;

/** A parsed image embed size; `height` is absent for a width-only size. */
interface ImageSize {
  width: string;
  height?: string;
}

/** Parse an image size, or `undefined` when the text is alt text. */
function parseImageSize(text: string): ImageSize | undefined {
  const match = IMAGE_SIZE_RE.exec(text.trim());
  if (!match) return undefined;
  // Obsidian treats a zero height as no height (`NT`: `0 !== r`), so
  // `|300x0` is width-only rather than an image hidden by height="0".
  if (match[2] && Number(match[2]) !== 0) return { width: match[1], height: match[2] };
  return { width: match[1] };
}

/**
 * Split an image embed's display text into alt text and size, as Obsidian
 * does: the text after the LAST `|` is a size when it parses as one, and
 * everything before it is alt text; with no size, the whole display text is
 * alt text. So `|alt text` is alt at natural size, `|alt text|300` is both,
 * and `|300|alt text` is the alt text `300|alt text` — not a size, because
 * Obsidian only reads a size from a trailing segment.
 */
function splitImageDisplay(display: string): { alt: string; size?: ImageSize } {
  const bar = display.lastIndexOf("|");
  if (bar !== -1) {
    const size = parseImageSize(display.slice(bar + 1));
    return size ? { alt: display.slice(0, bar), size } : { alt: display };
  }
  const size = parseImageSize(display);
  return size ? { alt: "", size } : { alt: display };
}

/**
 * One image embed as GFM markdown or a single `<img>` tag.
 *
 * A plain embed stays markdown, so the inliner swaps its destination and the
 * API renders it inline like any other image. A sized embed must be HTML —
 * markdown has no width — and so must one that is sized and given alt text.
 * The alt in the HTML form lands in an attribute, where a backslash is not an
 * escape, so it uses the character-reference form of the same escape set;
 * otherwise it goes in a markdown label with the backslash form.
 *
 * With no alt, a sized embed keeps the file name as its alt, as it always has.
 */
function imageEmbedToMarkdown(path: string, display?: string): string {
  const { alt, size } = splitImageDisplay((display ?? "").trim());

  if (size) {
    const height = size.height ? ` height="${size.height}"` : "";
    const altText = alt ? escapeHtmlAttribute(alt) : path;
    return `<img src="${path}" width="${size.width}"${height} alt="${altText}">`;
  }

  // Angle brackets: a vault file name can hold spaces and parentheses, which
  // a bare markdown destination cannot. `<` and `>` end or break that form, so
  // they are escaped (macOS and Linux allow them in names).
  const dest = path.replace(/[<>]/g, "\\$&");
  return `![${alt ? escapeVerbatimText(alt) : path}](<${dest}>)`;
}

function obsidianToGfm(md: string, options: PreprocessOptions): string {
  let result = md;

  // 1. Strip comments %%...%% (block and inline)
  result = result.replace(/%%[\s\S]*?%%/g, "");

  // 2. Strip block reference IDs (trailing ^block-id), unless the caller
  //    needs them kept (canvas note text: the server reads the marker to
  //    resolve a #^blockid subpath, and strips it from what it renders).
  if (!options.keepBlockIds) {
    result = result.replace(/ \^[\w-]+$/gm, "");
  }

  // 3. Image embeds: ![[file.ext]], ![[file.ext|300]] and
  //    ![[file.ext|alt text]] (files with image extensions). The pipe is read
  //    the way Obsidian reads it (1.13.7: `$E` splits the display text off
  //    first, then the `iembed` markdown transformer tests it with `NT`/`FT`):
  //    a trailing `|WIDTH[xHEIGHT]` is a size and everything before it is alt
  //    text; with no size, the whole display text is alt text. So
  //    `![[image.png|alt text]]` renders the image at natural size with that
  //    alt — Obsidian never prints the raw link, and neither may this.
  result = result.replace(IMAGE_EMBED_RE, (_match, path: string, display?: string) =>
    imageEmbedToMarkdown(path, display),
  );

  // 4. Non-image embeds: ![[note]] and ![[note#heading]]
  //    Left as-is here, resolved by resolveNoteEmbeds() which has vault access.
  //    If not resolved (e.g. depth limit hit), fallback converts to italic ref.

  // 5. Wikilinks: [[page|alias]] -> alias, [[page#heading]] -> heading, [[page]] -> page
  //    A leading "!" marks an embed, not a link, so those are returned untouched
  //    (matched rather than looked behind, because mobile WebKit lacks lookbehind).
  result = result.replace(
    /(!?)\[\[([^\]|]+?)(?:#([^\]|]*?))?(?:\|([^\]]*?))?\]\]/g,
    (match, bang: string, page: string, heading?: string, alias?: string) => {
      if (bang) return match;
      if (alias) return alias;
      if (heading) return heading;
      return page;
    },
  );

  // 6. Highlights: ==text== -> <mark>text</mark>
  result = result.replace(/==(.+?)==/g, "<mark>$1</mark>");

  // 7. Image resize in standard syntax: ![alt|300](url) -> <img>
  result = result.replace(
    new RegExp(String.raw`!\[([^|\]]*)\|(\d+(?:x\d+)?)\]\(${MD_IMAGE_DEST}\)`, "g"),
    (_match, alt: string, size: string, dest: string) => {
      const url = unwrapImageDest(dest);
      if (size.includes("x")) {
        const [w, h] = size.split("x");
        return `<img src="${url}" width="${w}" height="${h}" alt="${alt}">`;
      }
      return `<img src="${url}" width="${size}" alt="${alt}">`;
    },
  );

  // 8. Tags: #tag and #nested/tag -> inline code (but not inside headings or #! patterns)
  //    Avoid matching inside headings (# Heading), hex colors (#fff), numbered refs (#123),
  //    or an HTML tag: `<td style="background-color: #f6f8fa">` must keep its colour
  //    readable, because a backticked value would no longer parse as CSS.
  //    An HTML tag is matched first and returned untouched; the leading character of a
  //    tag is captured rather than matched with a lookbehind, because lookbehind is
  //    unsupported on older iOS WebKit and this plugin runs on mobile.
  result = result.replace(
    /<[a-zA-Z/!][^<>\r\n]*>|(^|\s)#([a-zA-Z][a-zA-Z0-9_/-]*)/gm,
    (match, lead?: string, tag?: string) =>
      lead === undefined || tag === undefined ? match : `${lead}\`#${tag}\``,
  );

  // 9. Callouts: convert Obsidian types to GFM alerts
  //    > [!type]  or  > [!type] Title  or  > [!type]- / > [!type]+
  //    A title stays on the marker line: the server shows it in the alert
  //    header, next to the icon, in place of the type name. The blank quoted
  //    line after it ends that paragraph, so a body starting with `---`,
  //    `2.` or an indented line keeps its own block type instead of joining
  //    the marker line (a `---` would make it a setext heading).
  result = result.replace(
    /^(>\s*)\[!(\w+)\]([+-])?(?:[ \t]+(.+))?$/gm,
    (_match, prefix: string, type: string, _foldable?: string, title?: string) => {
      const gfmType = CALLOUT_MAP[type.toLowerCase()] ?? "NOTE";
      return title
        ? `${prefix}[!${gfmType}] ${title.trim()}\n${prefix.trimEnd()}`
        : `${prefix}[!${gfmType}]`;
    },
  );

  return result;
}

/**
 * Extract a heading section from markdown content.
 * Returns everything from the heading to the next heading of equal or higher level.
 */
export function extractSection(content: string, heading: string): string {
  const lines = content.split("\n");
  let startIdx = -1;
  let startLevel = 0;

  for (let i = 0; i < lines.length; i++) {
    const headingMatch = lines[i].match(/^(#{1,6})\s+(.+)/);
    if (!headingMatch) continue;

    const level = headingMatch[1].length;
    const text = headingMatch[2].trim();

    if (startIdx < 0 && text.toLowerCase() === heading.toLowerCase()) {
      startIdx = i;
      startLevel = level;
    } else if (startIdx >= 0 && level <= startLevel) {
      return lines.slice(startIdx, i).join("\n");
    }
  }

  return startIdx >= 0 ? lines.slice(startIdx).join("\n") : content;
}

/**
 * Extract a block by its ^block-id reference.
 */
export function extractBlock(content: string, blockId: string): string {
  const lines = content.split("\n");
  for (const line of lines) {
    if (line.includes(`^${blockId}`)) {
      return line.replace(` ^${blockId}`, "").trim();
    }
  }
  return content;
}
