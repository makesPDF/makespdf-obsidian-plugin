/**
 * Tests for the save notice's layout-warning rules: `glyph-missing` from
 * `X-Layout-Warnings` adds the font-docs warning, and every other response
 * (absent header, other codes, a malformed value) leaves the usual "PDF saved"
 * notice alone.
 */
import { describe, it, expect } from "vitest";

import {
  FONT_DOCS_LINK_TEXT,
  GLYPH_MISSING_CODE,
  GLYPH_MISSING_TEXT,
  fontDocsUrl,
  hasGlyphMissing,
  layoutWarningCodes,
  savedPdfNotice,
} from "./layout-warnings";

describe("layoutWarningCodes", () => {
  it("splits the comma-separated codes and trims the spaces", () => {
    expect(
      layoutWarningCodes({
        "X-Layout-Warnings": "page-split-overflow, glyph-missing",
      }),
    ).toEqual(["page-split-overflow", "glyph-missing"]);
  });

  it("finds the header whatever case the transport preserved", () => {
    for (const name of ["X-Layout-Warnings", "x-layout-warnings", "X-LAYOUT-WARNINGS"]) {
      expect(layoutWarningCodes({ [name]: GLYPH_MISSING_CODE })).toEqual([
        GLYPH_MISSING_CODE,
      ]);
    }
  });

  it("returns no codes when the header is absent, blank or only separators", () => {
    expect(layoutWarningCodes(undefined)).toEqual([]);
    expect(layoutWarningCodes({})).toEqual([]);
    expect(layoutWarningCodes({ "X-Layout-Warnings": "" })).toEqual([]);
    expect(layoutWarningCodes({ "X-Layout-Warnings": " , ,, " })).toEqual([]);
  });
});

describe("hasGlyphMissing", () => {
  it("is true when glyph-missing rides with other codes", () => {
    expect(
      hasGlyphMissing({
        "X-Layout-Warnings": "page-split-overflow,glyph-missing",
      }),
    ).toBe(true);
  });

  it("is false for other codes, an absent header and a code that merely contains it", () => {
    expect(hasGlyphMissing({ "X-Layout-Warnings": "page-split-overflow" })).toBe(
      false,
    );
    expect(hasGlyphMissing(undefined)).toBe(false);
    expect(hasGlyphMissing({ "X-Layout-Warnings": "not-glyph-missing" })).toBe(
      false,
    );
  });
});

describe("fontDocsUrl", () => {
  it("points at the hosted docs for the default URL", () => {
    expect(fontDocsUrl("https://makespdf.com")).toBe(
      "https://makespdf.com/docs/fonts",
    );
    expect(fontDocsUrl("")).toBe("https://makespdf.com/docs/fonts");
    expect(fontDocsUrl(undefined)).toBe("https://makespdf.com/docs/fonts");
  });

  it("stays on a self-hosted API URL and drops its trailing slashes", () => {
    expect(fontDocsUrl("https://pdf.example.com/")).toBe(
      "https://pdf.example.com/docs/fonts",
    );
    expect(fontDocsUrl("  https://pdf.example.com//  ")).toBe(
      "https://pdf.example.com/docs/fonts",
    );
  });
});

describe("savedPdfNotice", () => {
  const usual = {
    headers: { "X-Pages": "2", "X-Render-Ms": "420" } as Record<string, string>,
    pdfName: "Q3 Field Notes.pdf",
    stats: "2 pages, 420ms",
    apiUrl: "https://makespdf.com",
  };

  it("keeps the usual notice, and only that, when the response named no warning", () => {
    const notice = savedPdfNotice(usual);

    expect(notice).toEqual({
      glyphMissing: false,
      message: "PDF saved: Q3 Field Notes.pdf (2 pages, 420ms)",
    });
    expect(notice.docsUrl).toBeUndefined();
  });

  it("keeps the usual notice for a different layout warning", () => {
    expect(
      savedPdfNotice({
        ...usual,
        headers: { "X-Layout-Warnings": "page-split-overflow" },
      }),
    ).toEqual({
      glyphMissing: false,
      message: "PDF saved: Q3 Field Notes.pdf (2 pages, 420ms)",
    });
  });

  it("still confirms the save, then warns and links the docs for glyph-missing", () => {
    const notice = savedPdfNotice({
      ...usual,
      headers: { "X-Layout-Warnings": "page-split-overflow,glyph-missing" },
    });

    expect(notice.glyphMissing).toBe(true);
    // The PDF was written, so the save line stays, followed by the warning.
    expect(notice.message).toBe(
      `PDF saved: Q3 Field Notes.pdf (2 pages, 420ms) ${GLYPH_MISSING_TEXT}`,
    );
    expect(notice.docsUrl).toBe("https://makespdf.com/docs/fonts");
    // The link text is what the notice's anchor shows.
    expect(FONT_DOCS_LINK_TEXT).toBe("See the font docs");
  });

  it("puts the font docs on a self-hosted server", () => {
    const notice = savedPdfNotice({
      ...usual,
      headers: { "X-Layout-Warnings": GLYPH_MISSING_CODE },
      apiUrl: "https://pdf.example.com/",
    });

    expect(notice.docsUrl).toBe("https://pdf.example.com/docs/fonts");
  });

  it("omits the empty stats parentheses when the server sent no stats", () => {
    expect(savedPdfNotice({ ...usual, stats: "" }).message).toBe(
      "PDF saved: Q3 Field Notes.pdf",
    );
  });
});
