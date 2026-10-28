import { describe, expect, it } from "vitest";

import {
  PAGE_NUMBER_FORMATS,
  PAGE_NUMBER_POSITIONS,
  isPageNumberFormat,
  isPageNumberPosition,
  pageNumberOptions,
} from "./page-numbers";
import { withNoteTitle } from "./note-title";
import { preprocessObsidian } from "./preprocess";

describe("pageNumberOptions", () => {
  it("sends nothing when page numbers are off", () => {
    expect(pageNumberOptions("off", "right")).toEqual({});
  });

  it("sends nothing for an unknown format, so the API cannot 400 on it", () => {
    expect(pageNumberOptions("roman", "left")).toEqual({});
    expect(pageNumberOptions("", "center")).toEqual({});
    expect(pageNumberOptions(undefined, "right")).toEqual({});
    expect(pageNumberOptions(null, "right")).toEqual({});
    expect(pageNumberOptions(3, "right")).toEqual({});
  });

  it("maps each of the three formats", () => {
    expect(pageNumberOptions("page-n-of-total", "right")).toEqual({
      pageNumbers: "page-n-of-total",
      pageNumberPosition: "right",
    });
    expect(pageNumberOptions("n-of-total", "center")).toEqual({
      pageNumbers: "n-of-total",
      pageNumberPosition: "center",
    });
    expect(pageNumberOptions("n", "left")).toEqual({
      pageNumbers: "n",
      pageNumberPosition: "left",
    });
  });

  it("omits an unknown position so the API default (right) applies", () => {
    expect(pageNumberOptions("page-n-of-total", "middle")).toEqual({
      pageNumbers: "page-n-of-total",
    });
    expect(pageNumberOptions("n", undefined)).toEqual({ pageNumbers: "n" });
  });

  it("labels the formats and positions the way the /markdown tool does", () => {
    expect(PAGE_NUMBER_FORMATS).toEqual({
      off: "Off",
      "page-n-of-total": "Page 3 of 12",
      "n-of-total": "3 / 12",
      n: "3",
    });
    expect(PAGE_NUMBER_POSITIONS).toEqual({
      right: "Right",
      center: "Center",
      left: "Left",
    });
  });

  it("guards both stored values against a hand-edited data.json", () => {
    expect(isPageNumberFormat("off")).toBe(true);
    expect(isPageNumberFormat("n-of-total")).toBe(true);
    expect(isPageNumberFormat("pageNumbers")).toBe(false);
    expect(isPageNumberFormat(1)).toBe(false);

    expect(isPageNumberPosition("left")).toBe(true);
    expect(isPageNumberPosition("middle")).toBe(false);
    expect(isPageNumberPosition(null)).toBe(false);
  });
});

describe("note frontmatter page numbers", () => {
  it("reaches the request with the default (off) setting", () => {
    // The plugin sends the note's frontmatter block verbatim, so with the
    // setting off (no explicit options) the API reads these keys itself. Both
    // passes that touch a note before the request must leave the block intact.
    const note = [
      "---",
      "pageNumbers: page-n-of-total",
      "pageNumberPosition: left",
      "---",
      "",
      "Body text",
    ].join("\n");

    const sent = preprocessObsidian(withNoteTitle(note, "My Note"));

    expect(sent).toContain("pageNumbers: page-n-of-total");
    expect(sent).toContain("pageNumberPosition: left");
    expect(sent.indexOf("pageNumbers")).toBeLessThan(sent.indexOf("# My Note"));
  });
});
