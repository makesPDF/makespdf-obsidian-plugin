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
  GLYPH_MISSING_NOTICE_MS,
  GLYPH_MISSING_TEXT,
  drawSavedNotice,
  fontDocsUrl,
  hasGlyphMissing,
  layoutWarningCodes,
  savedPdfNotice,
  type NoticeClickEvent,
  type NoticeFragment,
  type NoticeLink,
  type SavedNoticeHost,
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
    // No docs page to link, by construction.
    expect("docsUrl" in notice).toBe(false);
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

    expect(notice).toMatchObject({
      glyphMissing: true,
      // The PDF was written, so the save line stays, followed by the warning.
      message: `PDF saved: Q3 Field Notes.pdf (2 pages, 420ms) ${GLYPH_MISSING_TEXT}`,
      docsUrl: "https://makespdf.com/docs/fonts",
    });
    // The link text is what the notice's anchor shows.
    expect(FONT_DOCS_LINK_TEXT).toBe("See the font docs");
  });

  it("puts the font docs on a self-hosted server", () => {
    expect(
      savedPdfNotice({
        ...usual,
        headers: { "X-Layout-Warnings": GLYPH_MISSING_CODE },
        apiUrl: "https://pdf.example.com/",
      }),
    ).toMatchObject({ docsUrl: "https://pdf.example.com/docs/fonts" });
  });

  it("omits the empty stats parentheses when the server sent no stats", () => {
    expect(savedPdfNotice({ ...usual, stats: "" }).message).toBe(
      "PDF saved: Q3 Field Notes.pdf",
    );
  });
});

/** The anchor the fake fragment hands out; a click records both of its effects. */
class FakeLink implements NoticeLink {
  readonly listeners: ((event: NoticeClickEvent) => void)[] = [];
  prevented = 0;

  constructor(
    readonly text: string,
    readonly href: string,
    readonly attrs: Record<string, string>,
  ) {}

  addEventListener(
    _type: "click",
    listener: (event: NoticeClickEvent) => void,
  ): void {
    this.listeners.push(listener);
  }

  click(): void {
    for (const listener of this.listeners) {
      listener({ preventDefault: () => (this.prevented += 1) });
    }
  }
}

/** The fragment the fake `createFragment` fills, so the drawn notice is inspectable. */
class FakeFragment implements NoticeFragment {
  readonly texts: string[] = [];
  readonly links: FakeLink[] = [];

  appendText(text: string): void {
    this.texts.push(text);
  }

  createEl(
    _tag: "a",
    options: { text: string; href: string; attr?: Record<string, string> },
  ): NoticeLink {
    const link = new FakeLink(options.text, options.href, options.attr ?? {});
    this.links.push(link);
    return link;
  }
}

/** Records what the notice asked obsidian to draw and to open. */
function fakeSavedNoticeHost() {
  const notices: { content: unknown; timeoutMs?: number }[] = [];
  const opened: string[] = [];
  let hidden = 0;
  let fragment: FakeFragment | undefined;

  const host: SavedNoticeHost = {
    createFragment(build) {
      fragment = new FakeFragment();
      build(fragment);
      return fragment;
    },
    notify(content, timeoutMs) {
      notices.push({ content, timeoutMs });
      return {
        hide: () => {
          hidden += 1;
        },
      };
    },
    openUrl(url) {
      opened.push(url);
    },
  };

  return {
    host,
    notices,
    opened,
    fragment: () => fragment,
    hidden: () => hidden,
  };
}

describe("drawSavedNotice", () => {
  const exportArgs = {
    headers: { "X-Pages": "2", "X-Render-Ms": "420" } as Record<string, string>,
    pdfName: "Q3 Field Notes.pdf",
    stats: "2 pages, 420ms",
    apiUrl: "https://makespdf.com",
  };

  it("draws only the usual notice when no character went missing", () => {
    const drawing = fakeSavedNoticeHost();

    drawSavedNotice(savedPdfNotice(exportArgs), drawing.host);

    // No fragment: the plain notice is exactly the one earlier versions showed.
    expect(drawing.fragment()).toBeUndefined();
    expect(drawing.notices).toHaveLength(1);
    expect(drawing.notices[0].content).toBe(
      "PDF saved: Q3 Field Notes.pdf (2 pages, 420ms)",
    );
    expect(drawing.notices[0].timeoutMs).toBeUndefined();
    expect(drawing.opened).toEqual([]);
  });

  it("draws the save line, the warning and a docs anchor carrying the real destination", () => {
    const saved = savedPdfNotice({
      ...exportArgs,
      headers: { "X-Layout-Warnings": "page-split-overflow,glyph-missing" },
    });
    const drawing = fakeSavedNoticeHost();

    drawSavedNotice(saved, drawing.host);

    const fragment = drawing.fragment();
    expect(fragment?.texts).toEqual([
      `PDF saved: Q3 Field Notes.pdf (2 pages, 420ms) ${GLYPH_MISSING_TEXT}`,
      " ",
    ]);
    expect(fragment?.links).toHaveLength(1);

    const link = fragment!.links[0];
    expect(link.text).toBe("See the font docs");
    // The anchor's own destination, not `#`: hover, middle-click and the
    // context menu's copy/open-link go to the docs too.
    expect(link.href).toBe("https://makespdf.com/docs/fonts");
    expect(link.attrs).toEqual({ target: "_blank" });

    // The notice carries the fragment, not the bare text, and stays up long
    // enough to be clicked.
    expect(drawing.notices).toHaveLength(1);
    expect(drawing.notices[0].content).toBe(fragment);
    expect(drawing.notices[0].timeoutMs).toBe(GLYPH_MISSING_NOTICE_MS);

    link.click();
    expect(link.prevented).toBe(1);
    expect(drawing.hidden()).toBe(1);
    expect(drawing.opened).toEqual(["https://makespdf.com/docs/fonts"]);
  });

  it("links the docs on a self-hosted server", () => {
    const drawing = fakeSavedNoticeHost();

    drawSavedNotice(
      savedPdfNotice({
        ...exportArgs,
        headers: { "X-Layout-Warnings": GLYPH_MISSING_CODE },
        apiUrl: "https://pdf.example.com/",
      }),
      drawing.host,
    );

    const link = drawing.fragment()!.links[0];
    expect(link.href).toBe("https://pdf.example.com/docs/fonts");

    link.click();
    expect(drawing.opened).toEqual(["https://pdf.example.com/docs/fonts"]);
  });
});
