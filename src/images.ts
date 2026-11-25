/**
 * Vault image inlining for exports: local image paths in markdown become
 * `data:` URIs read from the vault, remote URLs are left for the API server
 * to fetch.
 *
 * Shared by the note export and the canvas export. Kept free of the
 * `obsidian` import (the vault and its attachment resolution arrive as
 * structural arguments) so the rules are unit-testable, and moved out of
 * main.ts unchanged so the canvas builder can reuse this exact function
 * instead of growing a second inliner.
 */

import { unescapeHtmlAttribute, unescapeVerbatimText } from "./escaping";

/** A vault file, as far as this module cares. */
export interface VaultImageFile {
  path: string;
  extension: string;
  /**
   * The file's size, when the source knows it (Obsidian's `TFile.stat`), so
   * callers can apply a size cap before reading the bytes.
   */
  stat?: { size: number };
}

/** MIME types for image extensions. */
export const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
  bmp: "image/bmp",
  avif: "image/avif",
};

/**
 * The image extensions an export supports, in ONE place.
 *
 * Three passes have to agree on this list or an image silently stops being an
 * image: `resolveNoteEmbeds` skips exactly these embeds so it does not treat
 * them as notes, `preprocessObsidian` converts exactly these into markdown or
 * `<img>`, and the inliner can produce a MIME type for exactly these (see
 * {@link IMAGE_MIME}). MAK-285 was a divergence between the first two.
 */
export const IMAGE_EXTENSIONS: readonly string[] = Object.keys(IMAGE_MIME);

/** `.png`, `.jpg`, … at the end of a linkpath, case-insensitive. */
export const IMAGE_EXT_PATTERN = new RegExp(
  String.raw`\.(?:${IMAGE_EXTENSIONS.join("|")})$`,
  "i",
);

/** The same extensions as regex source, for a larger pattern's alternation. */
export const IMAGE_EXT_SOURCE = IMAGE_EXTENSIONS.join("|");

/**
 * A markdown image destination, as regex source with one capture group. In
 * order of preference:
 *
 *   - angle brackets, with `<` and `>` escaped inside: `<my (1).png>`
 *   - bare, with spaces and balanced parentheses: `a(b).png`, `my photo.png "t"`
 *   - bare, up to the first `)`, for an unbalanced `(`: `a(b.png`
 *
 * Stopping at the first `)` every time would cut `a (b).png` to `a (b`. The
 * balanced form is an unrolled loop because nesting the quantifiers
 * backtracks exponentially on an unterminated `![a](xxxx`.
 */
export const MD_IMAGE_DEST = String.raw`(<(?:\\.|[^<>\n\\])*>|[^()\n]*(?:\([^()\n]*\)[^()\n]*)*|[^)\n]+)`;

/**
 * `<a\>b.png>` -> `a>b.png`; a destination with no brackets is returned as
 * written.
 *
 * An angle-bracket destination is markdown, so every backslash escape in it is
 * undone — `escapeVerbatimText` writes the vault path that way so the later
 * raw-string rules of `preprocessObsidian` cannot rewrite it.
 */
export function unwrapImageDest(dest: string): string {
  if (!dest.startsWith("<") || !dest.endsWith(">")) return dest;
  return unescapeVerbatimText(dest.slice(1, -1));
}

/**
 * `![alt](dest)`, with an optional title after an angle-bracket destination.
 * The alt may hold a backslash-escaped `]` (an alt that quotes a bracket is
 * escaped so it prints verbatim), so its group is an escape-aware loop rather
 * than `[^\]]*` — the latter would end the alt at the escaped bracket and
 * leave the image uninlined. The whitespace before a title is bounded: `\s+`
 * would rescan a long blank run from every position the destination gives
 * back, which is quadratic.
 */
function mdImagePattern(): RegExp {
  return new RegExp(
    String.raw`(!\[(?:\\.|[^\]\\])*\]\()${MD_IMAGE_DEST}((?:\s{1,256}(?:"[^"\n]*"|'[^'\n]*'))?\))`,
    "g",
  );
}

/** The one vault method inlining needs. */
export interface VaultImageSource {
  readBinary(file: VaultImageFile): Promise<ArrayBuffer>;
}

/**
 * Resolve local image paths in the markdown to data: URIs by reading
 * from the Obsidian vault. Remote URLs (http/https) are left untouched
 * for the API server to fetch.
 */
export async function inlineVaultImages(
  md: string,
  vault: VaultImageSource,
  resolveAttachment: (linkpath: string, sourcePath: string) => VaultImageFile | null,
  sourcePath: string,
): Promise<string> {
  // Collect all local image references: ![alt](path) and <img src="path">
  const localImages = new Map<string, string>(); // path -> data URI

  // Each pattern's destination group; http(s) and data: paths are skipped below.
  const htmlImageRe = /<img\s[^>]*src="([^"]+)"/g;

  const paths = new Set<string>();
  // Each pattern's destination group, and how to turn what it captured back
  // into the path it names: a markdown destination is backslash-escaped, an
  // HTML attribute is written as character references. Both sources have to
  // agree with what the path really is, or the vault lookup misses.
  for (const [re, group, unwrap] of [
    [mdImagePattern(), 2, unwrapImageDest],
    [htmlImageRe, 1, unescapeHtmlAttribute],
  ] as const) {
    let m;
    while ((m = re.exec(md)) !== null) {
      const src = unwrap(m[group] ?? "");
      if (src && !src.startsWith("http://") && !src.startsWith("https://") && !src.startsWith("data:")) {
        paths.add(src);
      }
    }
  }

  // Read each local image from the vault
  await Promise.all(
    [...paths].map(async (path) => {
      try {
        // Resolve via Obsidian's attachment resolution (handles relative paths, attachment folders)
        const file = resolveAttachment(path, sourcePath);
        if (!file) return;

        const ext = file.extension.toLowerCase();
        const mime = IMAGE_MIME[ext];
        if (!mime) return;

        const buf = await vault.readBinary(file);

        // Convert to base64 data URI
        const bytes = new Uint8Array(buf);
        let binary = "";
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const b64 = btoa(binary);
        localImages.set(path, `data:${mime};base64,${b64}`);
      } catch {
        // File not found or unreadable, leave the path as-is
      }
    }),
  );

  if (localImages.size === 0) return md;

  // Swap each local path for its data URI, but ONLY where the path is the
  // image's destination — the `(…)` of `![alt](dest)` or the `src` of
  // `<img src="…">`.
  //
  // This used to be a blind global replace over the whole document, which
  // rewrote every occurrence of the path — in prose, in other images' alt
  // text, anywhere. The harmful cases were:
  //
  //   - the alt became the data URI, which doubled the request body and made
  //     the writer use the base64 blob as the figure's `/Alt` in the tagged
  //     PDF, so a screen reader read tens of thousands of characters of
  //     base64 instead of the file name;
  //   - an alt naming a *different*, inlineable image was swapped as well;
  //   - one path being a prefix of another (`a.png` vs `a.png.bak.png`) made
  //     the outcome depend on map order.
  //
  // An exact key lookup, scoped to the destination, fixes all three.
  const swap = (dest: string): string => {
    // The data URI needs no angle brackets, so they go with the path.
    const direct = localImages.get(unwrapImageDest(dest));
    if (direct) return direct;

    // `![alt](path "title")` — the destination span carries the title too, so
    // look the path up on its own rather than losing the inline. (Only
    // reachable when the same path is also referenced without a title, since
    // an unresolvable `path "title"` never makes it into the map.)
    //
    // Lazy, not `\S+`: a path may contain spaces (`my photo.png`), and a
    // greedy-on-non-space split would leave `my photo.png "the photo"` alone
    // and silently drop the image.
    const titled = /^(.+?)(\s+["'(].*)$/.exec(dest);
    if (titled) {
      const uri = localImages.get(titled[1]);
      if (uri) return `${uri}${titled[2]}`;
    }

    return dest;
  };

  return md
    .replace(mdImagePattern(), (_m, pre: string, dest: string, post: string) =>
      `${pre}${swap(dest)}${post}`,
    )
    .replace(/(<img\s[^>]*src=")([^"]+)(")/g, (_m, pre: string, raw: string, post: string) => {
      // The attribute value is read as HTML: character references are decoded
      // before the lookup. On a miss the value is left exactly as written, so
      // an unresolved tag is not re-encoded.
      const uri = localImages.get(unescapeHtmlAttribute(raw));
      return `${pre}${uri ?? raw}${post}`;
    });
}
