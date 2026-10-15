/**
 * Tests for the canvas image encoder: the browser image APIs it uses are
 * stubbed so the size decision, the re-encode and every fallback run in Node.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DOWNSCALE_JPEG_QUALITY,
  MAX_IMAGE_EDGE,
  bytesToBase64,
  bytesToDataUri,
  encodeImageForUpload,
  scaledDimensions,
} from "./image-encode";

// ---------------------------------------------------------------------------
// Browser stubs
// ---------------------------------------------------------------------------

/** Pixel size the stubbed decode reports; set per test. */
let decodedPixels = { width: 4800, height: 2700 };
/** When true the stubbed decode fires `onerror`. */
let decodeFails = false;
/** When true the stubbed pixels contain one transparent pixel. */
let pixelsHaveAlpha = false;
/** Bytes the stubbed `toBlob` returns. */
const encodedBytes = new Uint8Array([1, 2, 3, 4]);

class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 0;
  naturalHeight = 0;
  set src(_value: string) {
    queueMicrotask(() => {
      if (decodeFails) {
        this.onerror?.();
        return;
      }
      this.naturalWidth = decodedPixels.width;
      this.naturalHeight = decodedPixels.height;
      this.onload?.();
    });
  }
}

/** What the test's canvas was asked to do. */
const canvasCalls: Array<{
  width: number;
  height: number;
  drawn: [number, number] | null;
  mime: string | undefined;
  quality: number | undefined;
}> = [];

class FakeCanvas {
  width = 0;
  height = 0;
  private call = { width: 0, height: 0, drawn: null as [number, number] | null, mime: undefined as string | undefined, quality: undefined as number | undefined };

  getContext(): unknown {
    return {
      drawImage: (_source: unknown, _x: number, _y: number, w: number, h: number) => {
        this.call.drawn = [w, h];
      },
      getImageData: (_x: number, _y: number, w: number, h: number) => {
        const data = new Uint8ClampedArray(w * h * 4).fill(255);
        if (pixelsHaveAlpha) data[3] = 0;
        return { data };
      },
    };
  }

  toBlob(
    callback: (blob: Blob | null) => void,
    mime?: string,
    quality?: number,
  ): void {
    this.call.width = this.width;
    this.call.height = this.height;
    this.call.mime = mime;
    this.call.quality = quality;
    canvasCalls.push(this.call);
    callback(new Blob([encodedBytes]));
  }
}

type UrlStatics = {
  createObjectURL?: (blob: Blob) => string;
  revokeObjectURL?: (url: string) => void;
};

const urlStatics = URL as unknown as UrlStatics;
const realCreateObjectURL = urlStatics.createObjectURL;
const realRevokeObjectURL = urlStatics.revokeObjectURL;

beforeEach(() => {
  decodedPixels = { width: 4800, height: 2700 };
  decodeFails = false;
  pixelsHaveAlpha = false;
  canvasCalls.length = 0;
  urlStatics.createObjectURL = vi.fn(() => "blob:stub");
  urlStatics.revokeObjectURL = vi.fn();
  vi.stubGlobal("Image", FakeImage);
});

/** The canvas factory main.ts hands the encoder (a stubbed canvas, here). */
const makeCanvas = (): HTMLCanvasElement =>
  new FakeCanvas() as unknown as HTMLCanvasElement;

afterEach(() => {
  urlStatics.createObjectURL = realCreateObjectURL;
  urlStatics.revokeObjectURL = realRevokeObjectURL;
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------

describe("scaledDimensions", () => {
  it("never upscales", () => {
    expect(scaledDimensions(800, 600)).toEqual({ width: 800, height: 600 });
    expect(scaledDimensions(2400, 1000)).toEqual({ width: 2400, height: 1000 });
  });

  it("scales the long edge to the cap, preserving aspect ratio", () => {
    expect(scaledDimensions(4800, 2700)).toEqual({ width: 2400, height: 1350 });
    expect(scaledDimensions(2700, 4800)).toEqual({ width: 1350, height: 2400 });
  });

  it("rounds to whole pixels and floors at 1", () => {
    expect(scaledDimensions(4801, 4801)).toEqual({ width: 2400, height: 2400 });
    expect(scaledDimensions(100000, 3)).toEqual({ width: 2400, height: 1 });
  });

  it("honours a custom edge", () => {
    expect(scaledDimensions(1000, 500, MAX_IMAGE_EDGE)).toEqual({ width: 1000, height: 500 });
    expect(scaledDimensions(1000, 500, 100)).toEqual({ width: 100, height: 50 });
  });
});

describe("bytesToBase64 / bytesToDataUri", () => {
  it("encodes bytes without blowing the argument limit", () => {
    expect(bytesToBase64(new Uint8Array([72, 105]))).toBe("SGk=");
    const big = new Uint8Array(0x8000 * 2 + 3).fill(65);
    expect(bytesToBase64(big).length).toBe(Math.ceil(big.length / 3) * 4);
  });

  it("builds a data URI", () => {
    expect(bytesToDataUri(new Uint8Array([72, 105]), "image/png")).toBe(
      "data:image/png;base64,SGk=",
    );
  });
});

describe("encodeImageForUpload", () => {
  it("passes SVG through untouched, without decoding it", () => {
    const svg = new TextEncoder().encode("<svg></svg>").buffer;
    const result = encodeImageForUpload(svg, "image/svg+xml", makeCanvas);

    return result.then((encoded) => {
      expect(encoded.downscaled).toBe(false);
      expect(encoded.width).toBeUndefined();
      expect(encoded.dataUri).toBe(bytesToDataUri(new Uint8Array(svg), "image/svg+xml"));
      expect(canvasCalls).toHaveLength(0);
    });
  });

  it("keeps the original bytes for an image already within the cap", async () => {
    decodedPixels = { width: 1200, height: 800 };
    const bytes = new Uint8Array([7, 7, 7]).buffer;
    const encoded = await encodeImageForUpload(bytes, "image/png", makeCanvas);

    expect(encoded.downscaled).toBe(false);
    expect(encoded.width).toBe(1200);
    expect(encoded.height).toBe(800);
    expect(encoded.dataUri).toBe(bytesToDataUri(new Uint8Array(bytes), "image/png"));
    expect(canvasCalls).toHaveLength(0);
  });

  it("keeps the original bytes when the image cannot be decoded", async () => {
    decodeFails = true;
    const bytes = new Uint8Array([9, 9]).buffer;
    const encoded = await encodeImageForUpload(bytes, "image/webp", makeCanvas);

    expect(encoded.downscaled).toBe(false);
    expect(encoded.width).toBeUndefined();
    expect(encoded.dataUri).toBe(bytesToDataUri(new Uint8Array(bytes), "image/webp"));
    expect(canvasCalls).toHaveLength(0);
  });

  it("downscales an over-cap opaque image to JPEG at the quality setting", async () => {
    const encoded = await encodeImageForUpload(
      new Uint8Array([5]).buffer,
      "image/png",
      makeCanvas,
    );

    expect(encoded.downscaled).toBe(true);
    expect(encoded.width).toBe(2400);
    expect(encoded.height).toBe(1350);
    expect(encoded.dataUri).toBe(bytesToDataUri(encodedBytes, "image/jpeg"));
    expect(canvasCalls).toHaveLength(1);
    expect(canvasCalls[0].width).toBe(2400);
    expect(canvasCalls[0].height).toBe(1350);
    expect(canvasCalls[0].drawn).toEqual([2400, 1350]);
    expect(canvasCalls[0].mime).toBe("image/jpeg");
    expect(canvasCalls[0].quality).toBe(DOWNSCALE_JPEG_QUALITY);
  });

  it("keeps PNG when a downscaled image has transparency", async () => {
    pixelsHaveAlpha = true;
    const encoded = await encodeImageForUpload(
      new Uint8Array([5]).buffer,
      "image/png",
      makeCanvas,
    );

    expect(encoded.downscaled).toBe(true);
    expect(encoded.dataUri).toBe(bytesToDataUri(encodedBytes, "image/png"));
    expect(canvasCalls[0].mime).toBe("image/png");
    expect(canvasCalls[0].quality).toBeUndefined();
  });

  it("releases the object URL it created", async () => {
    const revoke = vi.fn();
    urlStatics.revokeObjectURL = revoke;
    await encodeImageForUpload(new Uint8Array([5]).buffer, "image/jpeg", makeCanvas);
    expect(revoke).toHaveBeenCalledWith("blob:stub");
  });
});
