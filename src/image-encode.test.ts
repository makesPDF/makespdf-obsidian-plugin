/**
 * Tests for the canvas image encoder: the browser image APIs it uses are
 * stubbed (see image-test-stubs.ts) so the size decision, the re-encode and
 * every fallback run in Node.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DOWNSCALE_JPEG_QUALITY,
  MAX_IMAGE_EDGE,
  bytesToBase64,
  bytesToDataUri,
  encodeImageForUpload,
  scaledDimensions,
} from "./image-encode";
import {
  fakeCanvasCalls,
  fakeDecode,
  fakeEncodedBytes,
  installImageStubs,
  makeFakeCanvas,
  stubUrl,
  uninstallImageStubs,
} from "./image-test-stubs";

beforeEach(installImageStubs);
afterEach(uninstallImageStubs);

const bufferOf = (values: number[]): ArrayBuffer => new Uint8Array(values).buffer;

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
  it("passes SVG through untouched, without decoding it", async () => {
    const svg = new TextEncoder().encode("<svg></svg>").buffer;
    const encoded = await encodeImageForUpload(svg, "image/svg+xml", makeFakeCanvas);

    expect(encoded.downscaled).toBe(false);
    expect(encoded.width).toBeUndefined();
    expect(encoded.dataUri).toBe(bytesToDataUri(new Uint8Array(svg), "image/svg+xml"));
    expect(fakeCanvasCalls).toHaveLength(0);
  });

  it("keeps the original bytes for an image already within the cap", async () => {
    fakeDecode.width = 1200;
    fakeDecode.height = 800;
    const bytes = bufferOf([7, 7, 7]);
    const encoded = await encodeImageForUpload(bytes, "image/png", makeFakeCanvas);

    expect(encoded.downscaled).toBe(false);
    expect(encoded.width).toBe(1200);
    expect(encoded.height).toBe(800);
    expect(encoded.dataUri).toBe(bytesToDataUri(new Uint8Array(bytes), "image/png"));
    expect(fakeCanvasCalls).toHaveLength(0);
  });

  it("keeps the original bytes when the image cannot be decoded", async () => {
    fakeDecode.fails = true;
    const bytes = bufferOf([9, 9]);
    const encoded = await encodeImageForUpload(bytes, "image/webp", makeFakeCanvas);

    expect(encoded.downscaled).toBe(false);
    expect(encoded.width).toBeUndefined();
    expect(encoded.dataUri).toBe(bytesToDataUri(new Uint8Array(bytes), "image/webp"));
    expect(fakeCanvasCalls).toHaveLength(0);
  });

  it("downscales an over-cap opaque image to JPEG at the quality setting", async () => {
    const encoded = await encodeImageForUpload(bufferOf([5]), "image/png", makeFakeCanvas);

    expect(encoded.downscaled).toBe(true);
    expect(encoded.width).toBe(2400);
    expect(encoded.height).toBe(1350);
    expect(encoded.dataUri).toBe(bytesToDataUri(fakeEncodedBytes, "image/jpeg"));
    expect(fakeCanvasCalls).toHaveLength(1);
    expect(fakeCanvasCalls[0].width).toBe(2400);
    expect(fakeCanvasCalls[0].height).toBe(1350);
    expect(fakeCanvasCalls[0].drawn).toEqual([2400, 1350]);
    expect(fakeCanvasCalls[0].mime).toBe("image/jpeg");
    expect(fakeCanvasCalls[0].quality).toBe(DOWNSCALE_JPEG_QUALITY);
  });

  it("keeps PNG when a downscaled image has transparency", async () => {
    fakeDecode.hasAlpha = true;
    const encoded = await encodeImageForUpload(bufferOf([5]), "image/png", makeFakeCanvas);

    expect(encoded.downscaled).toBe(true);
    expect(encoded.dataUri).toBe(bytesToDataUri(fakeEncodedBytes, "image/png"));
    expect(fakeCanvasCalls[0].mime).toBe("image/png");
    expect(fakeCanvasCalls[0].quality).toBeUndefined();
  });

  it("releases the object URL it created", async () => {
    await encodeImageForUpload(bufferOf([5]), "image/jpeg", makeFakeCanvas);
    expect(stubUrl.revokeObjectURL).toHaveBeenCalledWith("blob:stub");
  });
});
