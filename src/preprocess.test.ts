/**
 * Tests for the Obsidian to GFM preprocessor.
 */
import { describe, it, expect } from "vitest";

import { preprocessObsidian } from "./preprocess";

describe("preprocessObsidian", () => {
  it("strips comments", () => {
    expect(preprocessObsidian("before %%hidden%% after")).toBe("before  after");
    expect(preprocessObsidian("%%block\ncomment%%rest")).toBe("rest");
  });

  it("strips block reference IDs", () => {
    expect(preprocessObsidian("Some paragraph ^abc-123")).toBe("Some paragraph");
  });

  it("converts image embeds", () => {
    expect(preprocessObsidian("![[photo.png]]")).toBe("![photo.png](photo.png)");
    expect(preprocessObsidian("![[photo.png|300]]")).toBe(
      '<img src="photo.png" width="300" alt="photo.png">',
    );
    expect(preprocessObsidian("![[photo.png|300x200]]")).toBe(
      '<img src="photo.png" width="300" height="200" alt="photo.png">',
    );
  });

  it("leaves note embeds for the vault-aware resolver", () => {
    // resolveNoteEmbeds() runs before this and inlines or replaces every embed.
    // preprocessObsidian must not mistake an embed for a wikilink.
    expect(preprocessObsidian("![[My Note#Section]]")).toBe("![[My Note#Section]]");
    expect(preprocessObsidian("![[My Note]]")).toBe("![[My Note]]");
  });

  it("still converts adjacent wikilinks", () => {
    expect(preprocessObsidian("[[a]][[b]]")).toBe("ab");
  });

  it("converts wikilinks", () => {
    expect(preprocessObsidian("[[Page Name]]")).toBe("Page Name");
    expect(preprocessObsidian("[[Page Name|Display]]")).toBe("Display");
    expect(preprocessObsidian("[[Page#Heading]]")).toBe("Heading");
    expect(preprocessObsidian("[[Page#Heading|Alias]]")).toBe("Alias");
  });

  it("converts highlights to <mark>", () => {
    expect(preprocessObsidian("some ==highlighted== text")).toBe(
      "some <mark>highlighted</mark> text",
    );
  });

  it("converts image resize syntax", () => {
    expect(preprocessObsidian("![logo|200](https://example.com/logo.png)")).toBe(
      '<img src="https://example.com/logo.png" width="200" alt="logo">',
    );
    expect(preprocessObsidian("![logo|200x100](logo.png)")).toBe(
      '<img src="logo.png" width="200" height="100" alt="logo">',
    );
  });

  it("converts tags to inline code", () => {
    expect(preprocessObsidian("some text #project")).toBe("some text `#project`");
    expect(preprocessObsidian("tagged #nested/tag here")).toBe(
      "tagged `#nested/tag` here",
    );
  });

  it("does not convert headings to tags", () => {
    expect(preprocessObsidian("# Heading")).toBe("# Heading");
    expect(preprocessObsidian("## Sub Heading")).toBe("## Sub Heading");
  });

  it("maps Obsidian callout types to GFM alerts", () => {
    expect(preprocessObsidian("> [!tip]\n> content")).toBe("> [!TIP]\n> content");
    expect(preprocessObsidian("> [!danger]\n> content")).toBe("> [!CAUTION]\n> content");
    expect(preprocessObsidian("> [!success]\n> content")).toBe("> [!TIP]\n> content");
    expect(preprocessObsidian("> [!bug]\n> content")).toBe("> [!CAUTION]\n> content");
  });

  it("handles callout titles", () => {
    expect(preprocessObsidian("> [!tip] My Custom Title\n> content")).toBe(
      "> [!TIP]\n> **My Custom Title**\n> \n> content",
    );
  });

  it("strips callout fold markers", () => {
    expect(preprocessObsidian("> [!warning]-\n> content")).toBe("> [!WARNING]\n> content");
    expect(preprocessObsidian("> [!note]+\n> content")).toBe("> [!NOTE]\n> content");
  });

  it("handles a realistic note", () => {
    const input = `---
tags: [project, active]
aliases: [My Project]
---

# Project Notes

This links to [[Other Note]] and [[Meeting Notes|last meeting]].

%%TODO: review this section%%

Key findings were ==very important== for the project.

![[diagram.png|600]]

> [!danger] Security Issue
> We found a vulnerability in the auth flow.

Some paragraph with a reference ^ref-1

#project #status/active
`;
    const output = preprocessObsidian(input);

    // Wikilinks converted
    expect(output).toContain("Other Note");
    expect(output).toContain("last meeting");
    expect(output).not.toContain("[[");

    // Comments stripped
    expect(output).not.toContain("TODO: review");
    expect(output).not.toContain("%%");

    // Highlights converted
    expect(output).toContain("<mark>very important</mark>");

    // Image embed converted with size
    expect(output).toContain('<img src="diagram.png" width="600"');

    // Callout mapped
    expect(output).toContain("[!CAUTION]");
    expect(output).toContain("**Security Issue**");

    // Block ref stripped
    expect(output).not.toContain("^ref-1");

    // Tags as inline code
    expect(output).toContain("`#project`");
    expect(output).toContain("`#status/active`");
  });
});
