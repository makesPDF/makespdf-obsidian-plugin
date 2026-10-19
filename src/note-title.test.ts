/**
 * Tests for the note title heading.
 *
 * The title is inserted into the markdown BEFORE `preprocessObsidian` and the
 * API see it, so the escaping has to survive both. Every case below that could
 * plausibly appear in a file name is checked twice: once for the inserted
 * markdown, and once for what `preprocessObsidian` leaves of it.
 */

import { describe, expect, it } from "vitest";

import { noteTitleHeading, withNoteTitle } from "./note-title";
import { preprocessObsidian } from "./preprocess";

describe("noteTitleHeading", () => {
  it("renders a plain name as an H1", () => {
    expect(noteTitleHeading("basic test with image")).toBe("# basic test with image");
  });

  it("returns nothing for a blank title", () => {
    expect(noteTitleHeading("")).toBe("");
    expect(noteTitleHeading("   ")).toBe("");
    expect(noteTitleHeading("\n\t")).toBe("");
  });

  it("collapses whitespace so the heading stays one line", () => {
    expect(noteTitleHeading("  spaced   out  ")).toBe("# spaced out");
  });

  it("escapes the characters that would otherwise change the rendering", () => {
    expect(noteTitleHeading("my_note_v2")).toBe("# my\\_note\\_v2");
    expect(noteTitleHeading("*starred*")).toBe("# \\*starred\\*");
    expect(noteTitleHeading("[draft] ideas")).toBe("# \\[draft\\] ideas");
    expect(noteTitleHeading("a==b==")).toBe("# a\\=\\=b\\=\\=");
    expect(noteTitleHeading("#tag")).toBe("# \\#tag");
    expect(noteTitleHeading("<draft>")).toBe("# \\<draft\\>");
    expect(noteTitleHeading("back`tick`")).toBe("# back\\`tick\\`");
    expect(noteTitleHeading("back\\slash")).toBe("# back\\\\slash");
    // The four found by review: each one changed the printed text before.
    expect(noteTitleHeading("~~old~~ new")).toBe("# \\~\\~old\\~\\~ new");
    expect(noteTitleHeading("50%% off %% today")).toBe("# 50\\%\\% off \\%\\% today");
    expect(noteTitleHeading("Note ^dr")).toBe("# Note \\^dr");
    expect(noteTitleHeading("Tom &amp; Jerry")).toBe("# Tom \\&amp; Jerry");
  });
});

describe("withNoteTitle", () => {
  it("prepends the heading to a note with no front matter", () => {
    expect(withNoteTitle("here is an image", "basic test with image")).toBe(
      "# basic test with image\n\nhere is an image",
    );
  });

  it("inserts the heading after the front matter, leaving it first", () => {
    const note = "---\ntitle: From the note\nlang: ja\n---\n\nbody text";
    expect(withNoteTitle(note, "My Note")).toBe(
      "---\ntitle: From the note\nlang: ja\n---\n# My Note\n\nbody text",
    );
  });

  it("handles front matter with no blank line after it", () => {
    expect(withNoteTitle("---\nkey: value\n---\nbody", "My Note")).toBe(
      "---\nkey: value\n---\n# My Note\n\nbody",
    );
  });

  it("handles CRLF front matter", () => {
    expect(withNoteTitle("---\r\nkey: value\r\n---\r\n\r\nbody", "My Note")).toBe(
      "---\r\nkey: value\r\n---\r\n# My Note\r\n\r\nbody",
    );
  });

  it("puts the heading above an already-inserted properties table", () => {
    // main.ts inserts the properties table first, then the title, so the
    // reading order matches Obsidian: inline title, properties, body.
    const withTable = "---\nstatus: done\n---\n\n| Property | Value |\n| --- | --- |\n| status | done |\n\nbody";
    const result = withNoteTitle(withTable, "My Note");

    expect(result.indexOf("# My Note")).toBeLessThan(result.indexOf("| Property |"));
    expect(result).toContain("status: done");
  });

  it("leaves the note alone when there is no title", () => {
    expect(withNoteTitle("body text", "")).toBe("body text");
    expect(withNoteTitle("body text", "   ")).toBe("body text");
  });

  it("still titles a note that is only front matter", () => {
    expect(withNoteTitle("---\nkey: value\n---\n", "My Note")).toBe(
      "---\nkey: value\n---\n# My Note\n\n",
    );
  });

  it("terminates the front matter with a newline when the note ends on the fence", () => {
    // The API's front-matter reader needs the closing `---` followed by a
    // newline, and a note can end exactly on the fence.
    expect(withNoteTitle("---\nkey: value\n---", "My Note")).toBe(
      "---\nkey: value\n---\n# My Note\n\n",
    );
  });

  it("inserts a second heading if it is applied twice", () => {
    // Not idempotent by design: the caller inserts the title once, and a
    // function that tried to detect its own heading would be guessing at
    // whether the note already began with one.
    const once = withNoteTitle("body", "My Note");
    expect(withNoteTitle(once, "My Note")).toBe("# My Note\n\n# My Note\n\nbody");
  });
});

describe("the heading survives the Obsidian-to-GFM pass", () => {
  // preprocessObsidian runs after insertion, so a name that looks like a tag,
  // a wikilink, an embed, a highlight, a comment or a block id must not be
  // rewritten.
  const names = [
    "basic test with image",
    "my_note_v2",
    "#draft",
    "==important==",
    "[[draft]]",
    "![[photo.png]]",
    "![alt](photo.png)",
    "*starred*",
    "[bracket] note",
    "~~old~~ new",
    "50%% off %% today",
    "Note ^dr",
    "Tom &amp; Jerry",
    "100% done",
  ];

  it.each(names)("leaves the escaped heading for %j intact", (name) => {
    const inserted = withNoteTitle("body", name);
    const after = preprocessObsidian(inserted);
    const heading = after.split("\n")[0];

    expect(heading).toBe(noteTitleHeading(name));
    // and nothing the preprocessor inserts leaked into the heading line
    expect(heading).not.toContain("<mark>");
    expect(heading).not.toContain("`");
  });

  it("keeps the name's own text when the comment and block-id rules would eat it", () => {
    expect(preprocessObsidian(withNoteTitle("body", "50%% off %% today")).split("\n")[0]).toBe(
      "# 50\\%\\% off \\%\\% today",
    );
    expect(preprocessObsidian(withNoteTitle("body", "Note ^dr")).split("\n")[0]).toBe("# Note \\^dr");
  });

  it("is still an H1 after the Obsidian-to-GFM pass", () => {
    const after = preprocessObsidian(withNoteTitle("body", "my_note_v2"));
    expect(after.split("\n")[0]).toMatch(/^# /);
  });
});
