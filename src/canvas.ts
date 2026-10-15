/**
 * Builds the `POST /api/v1/canvas` request from an Obsidian canvas board
 * (JSON Canvas 1.0), following the contract in the makesPDF repo's
 * docs/json-canvas.md.
 *
 * What is sent, and how it maps onto the board:
 *
 * - `canvas` — the board's parsed JSON, with each `text` card preprocessed
 *   like a note (Obsidian syntax to GFM, local images inlined). The user's
 *   file is only ever read, never written.
 * - `files` — the contents the server cannot fetch itself, keyed by the
 *   exact path the canvas references: every `file` node and group
 *   `background` that resolves in the vault, as a `data:` URI (images,
 *   downscaled when over 2400px on the long edge) or as preprocessed
 *   markdown (`.md` notes, with their images inlined and the optional
 *   properties table). Unsupported types are omitted and render as the
 *   server's placeholder cards.
 * - `options` — page size, font family and the canvas name as the title.
 *
 * The endpoint caps two things: the request body at 25MB, and the `canvas`
 * document itself at 2MB characters — images inlined into card text count
 * toward the second; the `files` map does not. Both are refused here,
 * before any network call, with a message for the user; the body check
 * runs as files are added so a board far over the cap is not read and
 * base64-encoded in full first.
 *
 * Free of the `obsidian` import so the whole build is unit-testable.
 */

import { encodeImageForUpload } from "./image-encode";
import {
  IMAGE_MIME,
  inlineVaultImages,
  type VaultImageFile,
  type VaultImageSource,
} from "./images";
import { preprocessObsidian } from "./preprocess";

/** Max request body in bytes; mirrors `CANVAS_BODY_LIMIT` in makesPDF. */
export const CANVAS_BODY_LIMIT = 25 * 1024 * 1024;

/** Human label for the cap, for messages. */
export const CANVAS_BODY_LIMIT_LABEL = "25MB";

/**
 * Max `canvas` JSON in characters (UTF-16 code units); mirrors
 * `CANVAS_JSON_LIMIT` in makesPDF, which measures the same way on the
 * re-serialised object. Images inlined into card text live inside this
 * budget; file-node images travel in `files` and do not.
 */
export const CANVAS_JSON_LIMIT = 2 * 1024 * 1024;

/**
 * Image extensions the endpoint embeds; mirrors
 * `CANVAS_IMAGE_FILE_EXTENSIONS` in makesPDF. `gif` and `webp` still go
 * through this pipeline: today the server renders them as placeholder
 * cards, and the day its image decoder grows the formats, the request
 * already carries them.
 */
export const CANVAS_IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
]);

/** The vault lookups the builder needs, kept structural for tests. */
export interface CanvasVaultAdapter extends VaultImageSource {
  /** Obsidian's link resolution (`metadataCache.getFirstLinkpathDest`). */
  resolve: (linkpath: string, sourcePath: string) => VaultImageFile | null;
  readText: (file: VaultImageFile) => Promise<string>;
}

/** Options forwarded verbatim as the request's `options` object. */
export interface CanvasExportOptions {
  pageSize: string;
  fontFamily: string;
  title: string;
}

export interface CanvasExportDeps {
  vault: CanvasVaultAdapter;
  /** The "Properties to include" table, as the note export applies it. */
  withPropertyTable: (markdown: string) => string;
  /** Canvas factory for image downscaling (Obsidian's `createEl` in main.ts). */
  createCanvas: () => HTMLCanvasElement;
  /** Test hook; defaults to CANVAS_BODY_LIMIT. */
  maxBodyBytes?: number;
  /** Test hook; defaults to CANVAS_JSON_LIMIT. */
  maxCanvasJsonChars?: number;
}

export type CanvasExportResult =
  | { ok: true; body: string; bodyBytes: number }
  | {
      ok: false;
      reason: "invalid-json" | "too-large" | "canvas-too-large";
      message: string;
    };

/** The request body's `files` entry for one referenced path. */
export type CanvasFileEntry = { data: string } | { markdown: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** "26MB" for a too-large message. */
function megabytes(bytes: number): string {
  return `${Math.ceil(bytes / (1024 * 1024))}MB`;
}

function tooLarge(limit: number): CanvasExportResult {
  return {
    ok: false,
    reason: "too-large",
    message:
      `The canvas is over the ${megabytes(limit)} upload limit ` +
      `(the request carries the board, its images and any notes). ` +
      `Remove some images or trim the board and try again.`,
  };
}

function canvasTooLarge(limit: number): CanvasExportResult {
  return {
    ok: false,
    reason: "canvas-too-large",
    message:
      `The canvas is over the ${megabytes(limit)} limit the service sets for a board ` +
      `(card text and images embedded in cards count toward it). ` +
      `Move large images out of card text onto the board itself, or remove some cards, and try again.`,
  };
}

/** The exact strings the board references, in order, deduplicated. */
export function referencedPaths(canvas: Record<string, unknown>): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();
  if (!Array.isArray(canvas.nodes)) return paths;
  for (const node of canvas.nodes) {
    if (!isRecord(node)) continue;
    const path =
      node.type === "file" && typeof node.file === "string"
        ? node.file
        : node.type === "group" && typeof node.background === "string"
          ? node.background
          : null;
    if (!path || seen.has(path)) continue;
    seen.add(path);
    paths.push(path);
  }
  return paths;
}

/**
 * Rewrite every text card through the note pipeline (Obsidian syntax to
 * GFM, then local images inlined as data: URIs) so wikilinks and
 * `![[image]]` embeds in cards render like they do in notes.
 */
async function transformTextCards(
  canvas: Record<string, unknown>,
  sourcePath: string,
  deps: CanvasExportDeps,
): Promise<void> {
  if (!Array.isArray(canvas.nodes)) return;
  for (const node of canvas.nodes) {
    if (!isRecord(node)) continue;
    if (node.type !== "text" || typeof node.text !== "string") continue;
    const preprocessed = preprocessObsidian(node.text);
    node.text = await inlineVaultImages(
      preprocessed,
      deps.vault,
      deps.vault.resolve,
      sourcePath,
    );
  }
}

/** One `files` entry for a referenced path, or null when nothing is sent. */
async function fileEntry(
  path: string,
  canvasPath: string,
  deps: CanvasExportDeps,
): Promise<CanvasFileEntry | null> {
  const file = deps.vault.resolve(path, canvasPath);
  if (!file) return null;

  const extension = file.extension.toLowerCase();
  if (CANVAS_IMAGE_EXTENSIONS.has(extension)) {
    const mime = IMAGE_MIME[extension];
    if (!mime) return null;
    try {
      const bytes = await deps.vault.readBinary(file);
      const encoded = await encodeImageForUpload(bytes, mime, deps.createCanvas);
      return { data: encoded.dataUri };
    } catch {
      // Unreadable image: let the server draw its placeholder card.
      return null;
    }
  }

  if (extension === "md") {
    try {
      let text = await deps.vault.readText(file);
      text = deps.withPropertyTable(text);
      text = preprocessObsidian(text);
      text = await inlineVaultImages(text, deps.vault, deps.vault.resolve, file.path);
      return { markdown: text };
    } catch {
      // Unreadable note: the server draws the placeholder card instead.
      return null;
    }
  }

  return null;
}

/**
 * Build the request body for one canvas export. `canvasText` is the raw
 * `.canvas` file text, exactly as read from the vault.
 */
export async function buildCanvasExport(args: {
  canvasText: string;
  sourcePath: string;
  options: CanvasExportOptions;
  deps: CanvasExportDeps;
}): Promise<CanvasExportResult> {
  const { canvasText, sourcePath, options, deps } = args;
  const limit = deps.maxBodyBytes ?? CANVAS_BODY_LIMIT;

  let canvas: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(canvasText);
    if (!isRecord(parsed)) throw new Error("the canvas is not a JSON object");
    canvas = parsed;
  } catch {
    return {
      ok: false,
      reason: "invalid-json",
      message: "The canvas file is not valid JSON. Open it in Obsidian and try again.",
    };
  }

  await transformTextCards(canvas, sourcePath, deps);

  // The server measures the object form on re-serialisation, the same way,
  // and 400s an over-cap board before rendering. Catch it here instead: a
  // card-embedded image is inlined into the canvas JSON (unlike file-node
  // images, which travel in `files`), so this is the cap big embeds hit.
  const canvasJsonChars = JSON.stringify(canvas).length;
  const canvasLimit = deps.maxCanvasJsonChars ?? CANVAS_JSON_LIMIT;
  if (canvasJsonChars > canvasLimit) return canvasTooLarge(canvasLimit);

  // Inlined images dominate the body, and the exact JSON built so far is a
  // tight lower bound for the final one: bail as soon as it is over the
  // cap instead of reading (and encoding) every remaining file first.
  let bytes = canvasJsonChars;
  const files: Record<string, CanvasFileEntry> = {};
  for (const path of referencedPaths(canvas)) {
    const entry = await fileEntry(path, sourcePath, deps);
    if (!entry) continue;
    files[path] = entry;
    bytes += JSON.stringify(path).length + 1 + JSON.stringify(entry).length + 1;
    if (bytes > limit) return tooLarge(limit);
  }

  const payload: Record<string, unknown> = {
    canvas,
    options: {
      pageSize: options.pageSize,
      fontFamily: options.fontFamily,
      title: options.title,
    },
  };
  if (Object.keys(files).length > 0) payload.files = files;

  const body = JSON.stringify(payload);
  const bodyBytes = new TextEncoder().encode(body).length;
  if (bodyBytes > limit) return tooLarge(limit);

  return { ok: true, body, bodyBytes };
}
