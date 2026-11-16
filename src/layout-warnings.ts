/**
 * The layout warnings a successful render can name in `X-Layout-Warnings`.
 *
 * A binary PDF response hides the render's `layoutWarnings` array, so the API
 * sends the distinct warning codes in a comma-separated header
 * (`glyph-missing,page-split-overflow`) instead (MAK-347 in makesPDF). Of those
 * codes `glyph-missing` is the one the writer can act on: a character no
 * available font covers is drawn blank, so the PDF is still valid and still
 * worth saving, but the text has a hole in it.
 *
 * Free of the `obsidian` import so the notice rules are unit-testable;
 * `main.ts` only draws the result.
 */

import { DEFAULT_API_URL } from "./api-key";

/** The response header, matched case-insensitively. */
const LAYOUT_WARNINGS_HEADER = "x-layout-warnings";

/** A character no font covered: drawn blank, named by the warning. */
export const GLYPH_MISSING_CODE = "glyph-missing";

/** The sentence added to the save notice when the render could not draw a character. */
export const GLYPH_MISSING_TEXT =
  "Some characters could not be drawn because no font covers them.";

/** The link text that opens the font documentation. */
export const FONT_DOCS_LINK_TEXT = "See the font docs";

/**
 * The font docs page on the server the export was sent to: the hosted service
 * by default, a self-hosted deployment when the API URL is overridden.
 */
export function fontDocsUrl(apiUrl: unknown): string {
  const configured = typeof apiUrl === "string" ? apiUrl.trim() : "";
  const base = (configured || DEFAULT_API_URL).replace(/\/+$/, "");
  return `${base}/docs/fonts`;
}

/**
 * One header's value, whatever case the transport preserved it in.
 * `requestUrl` has been seen to hand back both `x-pages` and `X-Pages`, so a
 * warning lookup cannot depend on one spelling.
 */
function headerValue(
  headers: Record<string, string> | undefined,
  name: string,
): string | undefined {
  if (!headers) return undefined;
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name && typeof value === "string") return value;
  }
  return undefined;
}

/**
 * The distinct warning codes named by `X-Layout-Warnings`, in the order the
 * server sent them; an empty list when the header is absent or blank.
 */
export function layoutWarningCodes(
  headers: Record<string, string> | undefined,
): string[] {
  const raw = headerValue(headers, LAYOUT_WARNINGS_HEADER);
  if (!raw) return [];
  return raw
    .split(",")
    .map((code) => code.trim())
    .filter(Boolean);
}

/** True when the render named `glyph-missing`: some character was drawn blank. */
export function hasGlyphMissing(
  headers: Record<string, string> | undefined,
): boolean {
  return layoutWarningCodes(headers).includes(GLYPH_MISSING_CODE);
}

/**
 * What `renderPdf` shows once the PDF is written. A discriminated union so the
 * two fields cannot disagree: `docsUrl` exists exactly when the response named
 * `glyph-missing`.
 */
export type SavedPdfNotice =
  | {
      /** The response named no warning this notice acts on. */
      glyphMissing: false;
      /** The save confirmation, exactly as the plugin has always shown it. */
      message: string;
    }
  | {
      /** The response named `glyph-missing`: some character was drawn blank. */
      glyphMissing: true;
      /** The save confirmation, plus the warning. */
      message: string;
      /** The font docs page on the server the export was sent to. */
      docsUrl: string;
    };

/**
 * Plan the notice shown after a successful save. The misses are additive: the
 * PDF is already written, so the warning never suppresses the "PDF saved"
 * line, and a response without `glyph-missing` (including one with other
 * layout warnings) produces exactly the notice this plugin has always shown.
 */
export function savedPdfNotice(args: {
  headers: Record<string, string> | undefined;
  pdfName: string;
  /** The stats suffix `main.ts` builds from `X-Pages` / `X-Render-Ms`. */
  stats: string;
  apiUrl: unknown;
}): SavedPdfNotice {
  const message = `PDF saved: ${args.pdfName}${args.stats ? ` (${args.stats})` : ""}`;
  if (!hasGlyphMissing(args.headers)) return { glyphMissing: false, message };
  return {
    glyphMissing: true,
    message: `${message} ${GLYPH_MISSING_TEXT}`,
    docsUrl: fontDocsUrl(args.apiUrl),
  };
}

/** A click event as the docs anchor uses it; the DOM's `MouseEvent` satisfies it. */
export interface NoticeClickEvent {
  preventDefault(): void;
}

/** The docs anchor the notice draws; the real anchor element satisfies it. */
export interface NoticeLink {
  addEventListener(
    type: "click",
    listener: (event: NoticeClickEvent) => void,
  ): void;
}

/** The fragment the notice's text is built into; `createFragment` supplies it. */
export interface NoticeFragment {
  appendText(text: string): void;
  createEl(
    tag: "a",
    options: { text: string; href: string; attr?: Record<string, string> },
  ): NoticeLink;
}

/** An open notice, so the docs link can dismiss it before opening the browser. */
export interface NoticeHandle {
  hide(): void;
}

/**
 * The obsidian surface the notice needs: `main.ts` wires it to `createFragment`,
 * `Notice` and `window.open`, and the tests drive a fake, so the notice's actual
 * rendering is pinned without the real DOM.
 */
export interface SavedNoticeHost {
  createFragment(build: (fragment: NoticeFragment) => void): unknown;
  notify(content: unknown, timeoutMs?: number): NoticeHandle;
  openUrl(url: string): void;
}

/** How long the warning stays up: long enough to reach the docs link. */
export const GLYPH_MISSING_NOTICE_MS = 15_000;

/**
 * Draw the save notice through `host`. A response without `glyph-missing` gets
 * the plain "PDF saved" line every export has always shown. With it, the same
 * line gains the warning and a docs link: the anchor carries the real
 * destination, so hover, middle-click and context-menu open go to the docs, and
 * a left click also dismisses the notice and opens the browser.
 */
export function drawSavedNotice(
  saved: SavedPdfNotice,
  host: SavedNoticeHost,
): void {
  if (!saved.glyphMissing) {
    host.notify(saved.message);
    return;
  }

  const fragment = host.createFragment((frag) => {
    frag.appendText(saved.message);
    frag.appendText(" ");
    const link = frag.createEl("a", {
      text: FONT_DOCS_LINK_TEXT,
      href: saved.docsUrl,
      attr: { target: "_blank" },
    });
    link.addEventListener("click", (event) => {
      event.preventDefault();
      notice.hide();
      host.openUrl(saved.docsUrl);
    });
  });
  const notice = host.notify(fragment, GLYPH_MISSING_NOTICE_MS);
}
