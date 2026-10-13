/**
 * Tests for front matter property whitelisting and table rendering.
 */
import { describe, it, expect } from "vitest";

import {
  buildPropertyTable,
  escapeTableCell,
  formatPropertyValue,
  insertPropertyTable,
  parsePropertyWhitelist,
  splitFrontMatter,
} from "./properties";

describe("parsePropertyWhitelist", () => {
  it("returns an empty whitelist for an empty setting", () => {
    expect(parsePropertyWhitelist("")).toEqual({ names: [], includeAll: false });
    expect(parsePropertyWhitelist("  ,  ")).toEqual({ names: [], includeAll: false });
  });

  it("splits, trims and keeps whitelist order", () => {
    expect(parsePropertyWhitelist(" status , owner,due ")).toEqual({
      names: ["status", "owner", "due"],
      includeAll: false,
    });
  });

  it("drops case-insensitive duplicates", () => {
    expect(parsePropertyWhitelist("status, Status, STATUS")).toEqual({
      names: ["status"],
      includeAll: false,
    });
  });

  it("treats * as include-all, not a name", () => {
    expect(parsePropertyWhitelist("*")).toEqual({ names: [], includeAll: true });
    expect(parsePropertyWhitelist("status, *")).toEqual({
      names: ["status"],
      includeAll: true,
    });
  });
});

describe("formatPropertyValue", () => {
  it("prints text and numbers as-is", () => {
    expect(formatPropertyValue("open")).toBe("open");
    expect(formatPropertyValue(42)).toBe("42");
    expect(formatPropertyValue(3.5)).toBe("3.5");
  });

  it("prints booleans as Yes / No", () => {
    expect(formatPropertyValue(true)).toBe("Yes");
    expect(formatPropertyValue(false)).toBe("No");
  });

  it("prints dates as written", () => {
    // What parseYaml yields for an unquoted `due: 2026-10-14`.
    expect(formatPropertyValue(new Date("2026-10-14T00:00:00.000Z"))).toBe("2026-10-14");
    expect(formatPropertyValue(new Date("2026-10-14T09:30:00.000Z"))).toBe(
      "2026-10-14 09:30 UTC",
    );
    // A quoted date comes back as a string and stays that way.
    expect(formatPropertyValue("2026-10-14")).toBe("2026-10-14");
  });

  it("joins lists with a comma and a space", () => {
    expect(formatPropertyValue(["project", "active"])).toBe("project, active");
    expect(formatPropertyValue([1, 2])).toBe("1, 2");
    expect(formatPropertyValue([true, false])).toBe("Yes, No");
  });

  it("prints wikilinks as their display text", () => {
    expect(formatPropertyValue("[[Project Alpha]]")).toBe("Project Alpha");
    expect(formatPropertyValue("[[Project Alpha|Alpha]]")).toBe("Alpha");
    expect(formatPropertyValue("[[Note#Heading]]")).toBe("Heading");
    expect(formatPropertyValue("See [[Note|the note]]")).toBe("See the note");
    expect(formatPropertyValue(["[[One]]", "[[Two|Second]]"])).toBe("One, Second");
  });

  it("prints nested objects as compact key: value pairs", () => {
    expect(formatPropertyValue({ owner: "Jane", team: "Docs" })).toBe("owner: Jane, team: Docs");
    expect(formatPropertyValue({ due: new Date("2026-10-14T00:00:00.000Z") })).toBe(
      "due: 2026-10-14",
    );
  });

  it("skips null, undefined and empty values", () => {
    expect(formatPropertyValue(null)).toBeNull();
    expect(formatPropertyValue(undefined)).toBeNull();
    expect(formatPropertyValue("")).toBeNull();
    expect(formatPropertyValue("   ")).toBeNull();
    expect(formatPropertyValue([])).toBeNull();
    expect(formatPropertyValue({})).toBeNull();
    expect(formatPropertyValue(["a", "", null])).toBe("a");
  });
});

describe("escapeTableCell", () => {
  it("escapes pipes so a value cannot break the table", () => {
    expect(escapeTableCell("Jane | Doe")).toBe("Jane \\| Doe");
  });

  it("collapses newlines so a value cannot inject block-level markdown", () => {
    expect(escapeTableCell("line one\nline two")).toBe("line one line two");
    expect(escapeTableCell("line one\r\n\r\n# Heading")).toBe("line one # Heading");
  });

  it("escapes backslashes first so a literal one cannot swallow the pipe escape", () => {
    expect(escapeTableCell("a\\|b")).toBe("a\\\\\\|b");
  });
});

describe("splitFrontMatter", () => {
  it("reports no front matter for a plain note", () => {
    expect(splitFrontMatter("# Notes\n\nBody")).toEqual({
      exists: false,
      frontmatter: "",
      contentStart: 0,
    });
  });

  it("splits a standard block", () => {
    const note = "---\ntitle: My Note\nstatus: open\n---\n\n# Heading\n";
    const info = splitFrontMatter(note);
    expect(info.exists).toBe(true);
    expect(info.frontmatter).toBe("title: My Note\nstatus: open\n");
    expect(note.slice(info.contentStart)).toBe("\n# Heading\n");
  });

  it("handles an empty block and CRLF line endings", () => {
    expect(splitFrontMatter("---\n---\nBody").exists).toBe(true);
    expect(splitFrontMatter("---\n---\nBody").frontmatter).toBe("");
    const crlf = splitFrontMatter("---\r\ntitle: T\r\n---\r\nBody\r\n");
    expect(crlf.exists).toBe(true);
    expect(crlf.frontmatter).toBe("title: T\r\n");
    expect(crlf.contentStart).toBe("---\r\ntitle: T\r\n---\r\n".length);
  });

  it("handles a block that is the whole note", () => {
    const info = splitFrontMatter("---\nstatus: open\n---");
    expect(info.exists).toBe(true);
    expect(info.contentStart).toBe("---\nstatus: open\n---".length);
  });

  it("treats an unterminated block as body", () => {
    expect(splitFrontMatter("---\ntitle: My Note\n\nBody").exists).toBe(false);
  });

  it("does not mistake a longer dash line or a non-first-line block for front matter", () => {
    expect(splitFrontMatter("----\ntitle: T\n----\nBody").exists).toBe(false);
    expect(splitFrontMatter("\n---\ntitle: T\n---\nBody").exists).toBe(false);
  });
});

describe("buildPropertyTable", () => {
  const note = {
    title: "My Note",
    status: "open",
    Owner: "Jane",
    due: "2026-10-14",
    draft: false,
    tags: ["project", "active"],
    link: "[[Project Alpha|Alpha]]",
  };

  it("emits nothing for an empty whitelist", () => {
    expect(buildPropertyTable(note, "")).toBe("");
    expect(buildPropertyTable(note, " , ")).toBe("");
  });

  it("emits nothing when no whitelisted property exists", () => {
    expect(buildPropertyTable(note, "missing, also-missing")).toBe("");
    expect(buildPropertyTable(null, "*")).toBe("");
  });

  it("filters to named properties and prints them in whitelist order", () => {
    expect(buildPropertyTable(note, "due, status")).toBe(
      [
        "<!-- borderless -->",
        "| Property | Value |",
        "| --- | --- |",
        "| due | 2026-10-14 |",
        "| status | open |",
      ].join("\n"),
    );
  });

  it("matches names case-insensitively and prints the note's key spelling", () => {
    expect(buildPropertyTable(note, " OWNER ")).toContain("| Owner | Jane |");
  });

  it("includes every property in note order with *", () => {
    expect(buildPropertyTable(note, "*")).toBe(
      [
        "<!-- borderless -->",
        "| Property | Value |",
        "| --- | --- |",
        "| title | My Note |",
        "| status | open |",
        "| Owner | Jane |",
        "| due | 2026-10-14 |",
        "| draft | No |",
        "| tags | project, active |",
        "| link | Alpha |",
      ].join("\n"),
    );
  });

  it("prints named properties first with * and skips duplicates", () => {
    expect(buildPropertyTable(note, "status, *")).toBe(
      [
        "<!-- borderless -->",
        "| Property | Value |",
        "| --- | --- |",
        "| status | open |",
        "| title | My Note |",
        "| Owner | Jane |",
        "| due | 2026-10-14 |",
        "| draft | No |",
        "| tags | project, active |",
        "| link | Alpha |",
      ].join("\n"),
    );
  });

  it("skips a whitelisted property the note does not have", () => {
    const table = buildPropertyTable(note, "missing, status");
    expect(table).toContain("| status | open |");
    expect(table).not.toContain("missing");
  });

  it("skips rows with null or empty values", () => {
    const table = buildPropertyTable({ a: null, b: "", c: [], d: "kept" }, "*");
    expect(table).toContain("| d | kept |");
    expect(table).not.toContain("| a |");
    expect(table).not.toContain("| b |");
    expect(table).not.toContain("| c |");
  });

  it("escapes keys and values so neither can break the table", () => {
    const table = buildPropertyTable(
      { status: "open | closed", note: "line one\nline two" },
      "*",
    );
    expect(table).toContain("| status | open \\| closed |");
    expect(table).toContain("| note | line one line two |");
    expect(table.split("\n").filter((line) => line.startsWith("|")).length).toBe(4);
  });
});

describe("insertPropertyTable", () => {
  it("inserts the table after the closing --- with the front matter intact", () => {
    const note = "---\ntitle: My Note\nstatus: open\n---\n\n# Heading\n\nBody\n";
    const info = splitFrontMatter(note);
    const table = buildPropertyTable({ status: "open" }, "status");
    const result = insertPropertyTable(note, info.contentStart, table);

    expect(result).toBe(
      "---\ntitle: My Note\nstatus: open\n---\n" +
        "<!-- borderless -->\n" +
        "| Property | Value |\n" +
        "| --- | --- |\n" +
        "| status | open |\n" +
        "\n# Heading\n\nBody\n",
    );
    // The server still reads the front matter block, byte for byte.
    expect(result.startsWith(note.slice(0, info.contentStart))).toBe(true);
  });

  it("returns the note unchanged for an empty table", () => {
    const note = "---\nstatus: open\n---\nBody\n";
    const info = splitFrontMatter(note);
    expect(insertPropertyTable(note, info.contentStart, "")).toBe(note);
  });

  it("inserts at the top of a note without front matter", () => {
    expect(insertPropertyTable("Body\n", 0, "| a | b |")).toBe("| a | b |\n\nBody\n");
  });
});

describe("whitelist round trip", () => {
  it("sends a note with an empty whitelist through unchanged", () => {
    const note = "---\ntitle: My Note\nstatus: open\n---\n\n# Heading\n";
    const info = splitFrontMatter(note);
    const table = buildPropertyTable({ title: "My Note", status: "open" }, "");
    expect(insertPropertyTable(note, info.contentStart, table)).toBe(note);
  });
});
