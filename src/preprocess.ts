/**
 * Obsidian-flavoured markdown to GFM conversion.
 *
 * Pure string transforms with no Obsidian imports, so they can be
 * unit tested directly (see preprocess.test.ts).
 */

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

/**
 * Converts Obsidian-flavoured markdown to GFM-compatible markdown.
 *
 * Handles: wikilinks, image embeds with resize, highlights, comments,
 * block references, tags, callout titles/types, and image resize syntax.
 */
export function preprocessObsidian(md: string): string {
  let result = md;

  // 1. Strip comments %%...%% (block and inline)
  result = result.replace(/%%[\s\S]*?%%/g, "");

  // 2. Strip block reference IDs (trailing ^block-id)
  result = result.replace(/ \^[\w-]+$/gm, "");

  // 3. Image embeds: ![[file.ext]] and ![[file.ext|300]] (files with image extensions)
  result = result.replace(
    /!\[\[([^\]|]+\.(?:png|jpe?g|gif|svg|webp|bmp|avif))(?:\|(\d+(?:x\d+)?))?\]\]/gi,
    (_match, path: string, size?: string) => {
      if (size && size.includes("x")) {
        const [w, h] = size.split("x");
        return `<img src="${path}" width="${w}" height="${h}" alt="${path}">`;
      } else if (size) {
        return `<img src="${path}" width="${size}" alt="${path}">`;
      }
      return `![${path}](${path})`;
    },
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
    /!\[([^|\]]*)\|(\d+(?:x\d+)?)\]\(([^)]+)\)/g,
    (_match, alt: string, size: string, url: string) => {
      if (size.includes("x")) {
        const [w, h] = size.split("x");
        return `<img src="${url}" width="${w}" height="${h}" alt="${alt}">`;
      }
      return `<img src="${url}" width="${size}" alt="${alt}">`;
    },
  );

  // 8. Tags: #tag and #nested/tag -> inline code (but not inside headings or #! patterns)
  //    Avoid matching inside headings (# Heading), hex colors (#fff), or numbered refs (#123).
  //    The leading character is captured rather than matched with a lookbehind, because
  //    lookbehind is unsupported on older iOS WebKit and this plugin runs on mobile.
  result = result.replace(
    /(^|\s)#([a-zA-Z][a-zA-Z0-9_/-]*)/gm,
    (_match, lead: string, tag: string) => `${lead}\`#${tag}\``,
  );

  // 9. Callouts: convert Obsidian types/titles to GFM alerts
  //    > [!type]  or  > [!type] Title  or  > [!type]- / > [!type]+
  result = result.replace(
    /^(>\s*)\[!(\w+)\]([+-])?(?:[ \t]+(.+))?$/gm,
    (_match, prefix: string, type: string, _foldable?: string, title?: string) => {
      const gfmType = CALLOUT_MAP[type.toLowerCase()] ?? "NOTE";
      const titleLine = title ? `\n${prefix}**${title}**\n${prefix}` : "";
      return `${prefix}[!${gfmType}]${titleLine}`;
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
