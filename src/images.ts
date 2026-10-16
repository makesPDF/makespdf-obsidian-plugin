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
  const mdImageRe = /!\[[^\]]*\]\(([^)]+)\)/g;
  const htmlImageRe = /<img\s[^>]*src="([^"]+)"/g;

  const paths = new Set<string>();
  for (const re of [mdImageRe, htmlImageRe]) {
    let m;
    while ((m = re.exec(md)) !== null) {
      const src = m[1];
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

  // Replace all local paths with their data URIs
  let result = md;
  for (const [path, dataUri] of localImages) {
    // Escape for use in regex
    const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(escaped, "g"), dataUri);
  }
  return result;
}
