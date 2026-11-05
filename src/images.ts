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
 * A markdown image destination, as regex source with one capture group: an
 * angle-bracket destination (`<my (1).png>`), or a bare one that may hold
 * spaces and balanced parentheses (`a(b).png`, `my photo.png "title"`).
 * Stopping at the first `)` instead would cut `a (b).png` to `a (b`.
 *
 * The bare form is written as an unrolled loop because nesting the
 * quantifiers backtracks exponentially on an unterminated `![a](xxxx`.
 */
export const MD_IMAGE_DEST = String.raw`(<[^>\n]*>|[^()\n]*(?:\([^()\n]*\)[^()\n]*)*)`;

/** `<path>` -> `path`; anything else is returned as written. */
export function unwrapImageDest(dest: string): string {
  return dest.startsWith("<") && dest.endsWith(">") ? dest.slice(1, -1) : dest;
}

/** `![alt](dest)`, with an optional title after an angle-bracket destination. */
function mdImagePattern(): RegExp {
  return new RegExp(
    String.raw`(!\[[^\]]*\]\()${MD_IMAGE_DEST}((?:\s+(?:"[^"\n]*"|'[^'\n]*'))?\))`,
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

  // Match ![...](path) where path doesn't start with http
  const htmlImageRe = /<img\s[^>]*src="([^"]+)"/g;

  const paths = new Set<string>();
  for (const [re, group] of [
    [mdImagePattern(), 2],
    [htmlImageRe, 1],
  ] as const) {
    let m;
    while ((m = re.exec(md)) !== null) {
      const src = unwrapImageDest(m[group] ?? "");
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
    .replace(/(<img\s[^>]*src=")([^"]+)(")/g, (_m, pre: string, dest: string, post: string) =>
      `${pre}${swap(dest)}${post}`,
    );
}
