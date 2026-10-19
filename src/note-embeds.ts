/**
 * Note-embed resolution for exports: `![[note]]`, `![[note#Heading]]` and
 * `![[note#^block-id]]` are replaced by the referenced note's content, read
 * from the vault and recursively resolved, with guards for depth, total size
 * and circular references.
 *
 * Kept free of the `obsidian` import (the vault and its link resolution
 * arrive as structural arguments) so the rules are unit-testable — the same
 * shape as images.ts. Moved out of main.ts unchanged, apart from the image
 * guard on the unresolved-embed fallback below.
 *
 * Image embeds are deliberately NOT resolved here: they are left exactly as
 * written for preprocessObsidian (`![[image.png]]` -> `![image.png](image.png)`)
 * and inlineVaultImages (path -> `data:` URI) to handle.
 */

import { extractBlock, extractSection, preprocessObsidian } from "./preprocess";

/** Max recursion depth for note embeds to prevent runaway transclusion. */
export const MAX_EMBED_DEPTH = 3;

/** Max total size (in characters) of all inlined content to prevent payload bloat. */
export const MAX_EMBED_TOTAL_CHARS = 200_000;

/** Image extension pattern, used to skip image embeds (handled separately). */
export const IMAGE_EXT_PATTERN = /\.(?:png|jpe?g|gif|svg|webp|bmp|avif)$/i;

/** A vault note, as far as this module cares. */
export interface VaultNoteFile {
  path: string;
}

/** The one vault method note embedding needs. */
export interface VaultNoteSource {
  read(file: VaultNoteFile): Promise<string>;
}

/** Resolves an Obsidian linkpath to a vault file, or null. */
export type ResolveNoteLink = (linkpath: string, sourcePath: string) => VaultNoteFile | null;

/**
 * Recursively resolve `![[note]]` and `![[note#heading]]` embeds by reading
 * the referenced notes from the vault and inlining their content.
 *
 * Guards:
 * - Max depth of 3 levels to prevent runaway recursion
 * - Max total inlined characters (200k) to prevent payload bloat
 * - Circular reference detection via a visited set
 * - Image embeds are skipped (handled by preprocessObsidian + inlineVaultImages)
 */
export async function resolveNoteEmbeds(
  md: string,
  vault: VaultNoteSource,
  resolveLink: ResolveNoteLink,
  sourcePath: string,
  depth = 0,
  visited = new Set<string>(),
  totalChars = { value: 0 },
): Promise<string> {
  // Find all note embeds (not image embeds)
  const embedRe = /!\[\[([^\]]+)\]\]/g;
  // Every entry is a promise, including the literal slices, so the array is
  // uniformly awaitable rather than a mix of values and thenables.
  const parts: Promise<string>[] = [];
  let lastIndex = 0;
  let match;

  while ((match = embedRe.exec(md)) !== null) {
    const ref = match[1];
    const fullMatch = match[0];
    const matchStart = match.index;

    // Append text before this embed
    parts.push(Promise.resolve(md.slice(lastIndex, matchStart)));
    lastIndex = matchStart + fullMatch.length;

    // Skip image embeds (already handled)
    if (IMAGE_EXT_PATTERN.test(ref.split("|")[0])) {
      parts.push(Promise.resolve(fullMatch));
      continue;
    }

    // Parse ref: "Note Name" or "Note Name#Heading" or "Note Name#^block-id"
    const hashIdx = ref.indexOf("#");
    const notePath = hashIdx >= 0 ? ref.slice(0, hashIdx) : ref;
    const section = hashIdx >= 0 ? ref.slice(hashIdx + 1) : null;

    // Guard: depth limit
    if (depth >= MAX_EMBED_DEPTH) {
      parts.push(Promise.resolve(`*[embed depth limit: ${ref}]*`));
      continue;
    }

    // Guard: total size limit
    if (totalChars.value >= MAX_EMBED_TOTAL_CHARS) {
      parts.push(Promise.resolve(`*[embed size limit: ${ref}]*`));
      continue;
    }

    // Resolve the note
    const file = resolveLink(notePath, sourcePath);
    if (!file) {
      parts.push(Promise.resolve(`*[not found: ${ref}]*`));
      continue;
    }

    // Guard: circular reference
    if (visited.has(file.path)) {
      parts.push(Promise.resolve(`*[circular embed: ${ref}]*`));
      continue;
    }

    // Read and process the embedded note
    parts.push(
      (async () => {
        const newVisited = new Set(visited);
        newVisited.add(file.path);

        let content = await vault.read(file);

        // Strip YAML frontmatter from embedded notes
        if (content.startsWith("---")) {
          const endIdx = content.indexOf("\n---", 3);
          if (endIdx >= 0) {
            content = content.slice(endIdx + 4).trimStart();
          }
        }

        // If a heading section is specified, extract just that section
        if (section && !section.startsWith("^")) {
          content = extractSection(content, section);
        } else if (section?.startsWith("^")) {
          content = extractBlock(content, section.slice(1));
        }

        // Track total size
        totalChars.value += content.length;
        if (totalChars.value > MAX_EMBED_TOTAL_CHARS) {
          content = content.slice(0, MAX_EMBED_TOTAL_CHARS - totalChars.value + content.length);
          content += "\n\n*[truncated: embed size limit]*";
        }

        // Recursively resolve embeds in the inlined content
        content = await resolveNoteEmbeds(
          content, vault, resolveLink, file.path,
          depth + 1, newVisited, totalChars,
        );

        // Run the same syntax preprocessing on embedded content
        content = preprocessObsidian(content);

        return "\n\n" + content.trim() + "\n\n";
      })(),
    );
  }

  // Append remaining text after last embed
  parts.push(Promise.resolve(md.slice(lastIndex)));

  // Resolve all async parts
  const resolved = await Promise.all(parts);

  // No trailing cleanup pass over the leftover `![[...]]`. Every embed this
  // loop matched is either resolved above or replaced with an explicit
  // `*[...]*` guard message, so the only embeds still standing here are the
  // image embeds skipped on purpose — and they must reach
  // preprocessObsidian / inlineVaultImages unchanged. The old fallback here
  // rewrote them to `*See: image.png*`, which is what made every image in an
  // exported note print as a literal reference (MAK-266).
  return resolved.join("");
}
