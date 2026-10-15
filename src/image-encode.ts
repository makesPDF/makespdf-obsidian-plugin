/**
 * Vault images -> `data:` URIs for the canvas endpoint, downscaling large ones.
 *
 * The endpoint caps the whole request body at 25MB (base64 costs ~4/3 of the
 * bytes), and image base64 tends to dominate that budget, so an image whose
 * long edge exceeds MAX_IMAGE_EDGE is re-encoded at that size before it is
 * inlined. Everything else is sent byte-for-byte: no re-compression, no
 * quality loss.
 *
 * Decoding and encoding use the browser APIs Obsidian runs against (desktop
 * Electron and mobile WebViews) — `Image`, an offscreen `<canvas>` and
 * `toBlob` — and the `obsidian` import stays out of this module so the
 * encoding rules are unit-testable in Node (the image APIs are stubbed in
 * image-encode.test.ts). Anything undecodable falls back to the original
 * bytes: the server embeds it or shows its placeholder either way.
 */

/** Long-edge cap for images sent to the canvas endpoint. */
export const MAX_IMAGE_EDGE = 2400;

/** JPEG quality used when a downscaled image has no transparency to keep. */
export const DOWNSCALE_JPEG_QUALITY = 0.85;

/** A vault image ready for the `files` map of a canvas request. */
export interface EncodedImage {
  /** `data:<mime>;base64,…`, ready to use as a `files[path].data` value. */
  dataUri: string;
  /** Decoded pixel size, when the image could be decoded. */
  width?: number;
  height?: number;
  /** True when the pixels were re-encoded down to MAX_IMAGE_EDGE. */
  downscaled: boolean;
}

/**
 * Fit `width` x `height` inside a `maxEdge` box, preserving aspect ratio.
 * Never upscales, and rounds to whole pixels with a 1px floor so a very
 * skinny image cannot collapse to zero.
 */
export function scaledDimensions(
  width: number,
  height: number,
  maxEdge: number = MAX_IMAGE_EDGE,
): { width: number; height: number } {
  const longEdge = Math.max(width, height);
  if (longEdge <= maxEdge) return { width, height };
  const scale = maxEdge / longEdge;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Base64 for a byte array, in 32k chunks. A per-byte string concat (like the
 * markdown path's) is too slow for multi-megabyte images, and a single spread
 * over the whole buffer overflows the argument limit on large files.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** `data:<mime>;base64,…` for raw bytes. */
export function bytesToDataUri(bytes: Uint8Array, mime: string): string {
  return `data:${mime};base64,${bytesToBase64(bytes)}`;
}

interface DecodedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  /** Revoke the object URL the decode used. Call once the pixels are drawn. */
  release(): void;
}

/** Decode an image blob into something drawable, with its pixel size. */
function decodeImage(bytes: ArrayBuffer, mime: string): Promise<DecodedImage> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    const img = new Image();
    img.onload = () =>
      resolve({
        source: img,
        width: img.naturalWidth,
        height: img.naturalHeight,
        release: () => URL.revokeObjectURL(url),
      });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("image could not be decoded"));
    };
    img.src = url;
  });
}

/** `canvas.toBlob` as a promise; null when the browser gave no blob. */
function toBlobBytes(
  canvas: HTMLCanvasElement,
  mime: string,
  quality: number | undefined,
): Promise<Uint8Array | null> {
  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          resolve(null);
          return;
        }
        blob.arrayBuffer().then(
          (buffer) => resolve(new Uint8Array(buffer)),
          () => resolve(null),
        );
      },
      mime,
      quality,
    );
  });
}

/** Whether any pixel has partial or zero alpha. */
function hasTransparency(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): boolean {
  const data = ctx.getImageData(0, 0, width, height).data;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 255) return true;
  }
  return false;
}

/**
 * Prepare one vault image for upload: decode, downscale to MAX_IMAGE_EDGE
 * when needed, and encode as a `data:` URI. Falls back to the original bytes
 * when the image cannot be decoded or re-encoded — an oversized image that
 * still fits the body cap is better than a dropped one.
 *
 * `createCanvas` is the caller's canvas factory (Obsidian's `createEl` in
 * main.ts) so this module never reaches for a global `document`, which the
 * Obsidian lint rules warn about in favour of the window-local helpers.
 */
export async function encodeImageForUpload(
  bytes: ArrayBuffer,
  mime: string,
  createCanvas: () => HTMLCanvasElement,
): Promise<EncodedImage> {
  const original: EncodedImage = {
    dataUri: bytesToDataUri(new Uint8Array(bytes), mime),
    downscaled: false,
  };

  // SVG is vector: the endpoint embeds it natively, and rasterising it here
  // would only lose quality.
  if (mime === "image/svg+xml") return original;

  let decoded: DecodedImage;
  try {
    decoded = await decodeImage(bytes, mime);
  } catch {
    return original;
  }

  try {
    const { width, height } = scaledDimensions(decoded.width, decoded.height);
    if (width === decoded.width && height === decoded.height) {
      return { ...original, width, height };
    }

    const canvas = createCanvas();
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return { ...original, width, height };

    ctx.drawImage(decoded.source, 0, 0, width, height);

    // JPEG has no alpha channel: keep PNG only when there is transparency
    // to lose.
    const keepAlpha = hasTransparency(ctx, width, height);
    const outMime = keepAlpha ? "image/png" : "image/jpeg";
    const outBytes = await toBlobBytes(
      canvas,
      outMime,
      keepAlpha ? undefined : DOWNSCALE_JPEG_QUALITY,
    );
    if (!outBytes) return { ...original, width, height };

    return {
      dataUri: bytesToDataUri(outBytes, outMime),
      width,
      height,
      downscaled: true,
    };
  } finally {
    decoded.release();
  }
}
