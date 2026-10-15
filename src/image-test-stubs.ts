/**
 * Browser image-API stubs shared by image-encode.test.ts and canvas.test.ts,
 * so both suites exercise the real encoder against the same fake runtime.
 *
 * Not a test file itself (vitest collects only `*.test.ts`) and reachable
 * from no production entry point, so it never ships in the built main.js.
 */
import { vi } from "vitest";

/** Knobs the stubbed decode reads; installImageStubs resets them. */
export const fakeDecode = {
  width: 4800,
  height: 2700,
  fails: false,
  hasAlpha: false,
};

/** What the stubbed `toBlob` returns. */
export const fakeEncodedBytes = new Uint8Array([1, 2, 3, 4]);

/** One recorded re-encode request. */
export interface FakeCanvasCall {
  width: number;
  height: number;
  drawn: [number, number] | null;
  mime: string | undefined;
  quality: number | undefined;
}

/** Every `toBlob` call the fake canvases saw, in order. */
export const fakeCanvasCalls: FakeCanvasCall[] = [];

type UrlStatics = {
  createObjectURL?: (blob: Blob) => string;
  revokeObjectURL?: (url: string) => void;
};

/** The stubbed URL statics, for assertions (e.g. revoke calls). */
export const stubUrl = URL as unknown as UrlStatics;

const realCreateObjectURL = stubUrl.createObjectURL;
const realRevokeObjectURL = stubUrl.revokeObjectURL;

/** Stands in for the `Image` global the encoder decodes through. */
export class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 0;
  naturalHeight = 0;
  set src(_value: string) {
    queueMicrotask(() => {
      if (fakeDecode.fails) {
        this.onerror?.();
        return;
      }
      this.naturalWidth = fakeDecode.width;
      this.naturalHeight = fakeDecode.height;
      this.onload?.();
    });
  }
}

/** Stands in for the canvas the encoder draws and re-encodes through. */
export class FakeCanvas {
  width = 0;
  height = 0;
  private call: FakeCanvasCall = {
    width: 0,
    height: 0,
    drawn: null,
    mime: undefined,
    quality: undefined,
  };

  getContext(): unknown {
    return {
      drawImage: (_source: unknown, _x: number, _y: number, w: number, h: number) => {
        this.call.drawn = [w, h];
      },
      getImageData: (_x: number, _y: number, w: number, h: number) => {
        const data = new Uint8ClampedArray(w * h * 4).fill(255);
        if (fakeDecode.hasAlpha) data[3] = 0;
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
    fakeCanvasCalls.push(this.call);
    callback(new Blob([fakeEncodedBytes]));
  }
}

/** The canvas factory main.ts hands the encoder (a stubbed canvas, here). */
export function makeFakeCanvas(): HTMLCanvasElement {
  return new FakeCanvas() as unknown as HTMLCanvasElement;
}

/** Install the fakes and reset the knobs; call in `beforeEach`. */
export function installImageStubs(): void {
  fakeDecode.width = 4800;
  fakeDecode.height = 2700;
  fakeDecode.fails = false;
  fakeDecode.hasAlpha = false;
  fakeCanvasCalls.length = 0;
  stubUrl.createObjectURL = vi.fn(() => "blob:stub");
  stubUrl.revokeObjectURL = vi.fn();
  vi.stubGlobal("Image", FakeImage);
}

/** Restore the real globals; call in `afterEach`. */
export function uninstallImageStubs(): void {
  stubUrl.createObjectURL = realCreateObjectURL;
  stubUrl.revokeObjectURL = realRevokeObjectURL;
  vi.unstubAllGlobals();
}
