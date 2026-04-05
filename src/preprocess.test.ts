/**
 * Tests for Obsidian → GFM preprocessing.
 *
 * We can't import main.ts directly (it imports from "obsidian"),
 * so we extract the preprocessor and test via inline snapshot.
 */
import { describe, it, expect } from "vitest";

// Copy of preprocessObsidian for testing — kept in sync with main.ts
// In a real setup we'd extract to a shared module, but obsidian types
// make that awkward.

const CALLOUT_MAP: Record<string, string> = {
  note: "NOTE", tip: "TIP", hint: "TIP", important: "IMPORTANT",
  warning: "WARNING", attention: "WARNING", caution: "CAUTION",
  info: "NOTE", abstract: "NOTE", summary: "NOTE", tldr: "NOTE",
  todo: "NOTE", success: "TIP", check: "TIP", done: "TIP",
  question: "NOTE", help: "NOTE", faq: "NOTE",
  failure: "CAUTION", fail: "CAUTION", missing: "CAUTION",
  danger: "CAUTION", error: "CAUTION", bug: "CAUTION",
  example: "NOTE", quote: "NOTE", cite: "NOTE",
};

function preprocessObsidian(md: string): string {
  let result = md;
  result = result.replace(/%%[\s\S]*?%%/g, "");
  result = result.replace(/ \^[\w-]+$/gm, "");
  result = result.replace(
    /!\[\[([^\]|]+\.(?:png|jpe?g|gif|svg|webp|bmp|avif))(?:\|(\d+(?:x\d+)?))?\]\]/gi,
    (_m, path: string, size?: string) => {
      if (size && size.includes("x")) {
        const [w, h] = size.split("x");
        return `<img src="${path}" width="${w}" height="${h}" alt="${path}">`;
      } else if (size) {
        return `<img src="${path}" width="${size}" alt="${path}">`;
      }
      return `![${path}](${path})`;
    },
  );
  result = result.replace(/!\[\[([^\]]+)\]\]/g, (_m, ref: string) => `*See: ${ref}*`);
  result = result.replace(
    /\[\[([^\]|]+?)(?:#([^\]|]*?))?(?:\|([^\]]*?))?\]\]/g,
    (_m, page: string, heading?: string, alias?: string) => {
      if (alias) return alias;
      if (heading) return heading;
      return page;
    },
  );
  result = result.replace(/==(.+?)==/g, "<mark>$1</mark>");
  result = result.replace(
    /!\[([^|\]]*)\|(\d+(?:x\d+)?)\]\(([^)]+)\)/g,
    (_m, alt: string, size: string, url: string) => {
      if (size.includes("x")) {
        const [w, h] = size.split("x");
        return `<img src="${url}" width="${w}" height="${h}" alt="${alt}">`;
      }
      return `<img src="${url}" width="${size}" alt="${alt}">`;
    },
  );
  result = result.replace(
    /(?<=\s|^)#([a-zA-Z][a-zA-Z0-9_/-]*)/gm,
    (_m, tag: string) => `\`#${tag}\``,
  );
  result = result.replace(
    /^(>\s*)\[!(\w+)\]([+-])?(?:[ \t]+(.+))?$/gm,
    (_m, prefix: string, type: string, _fold?: string, title?: string) => {
      const gfmType = CALLOUT_MAP[type.toLowerCase()] ?? "NOTE";
      const titleLine = title ? `\n${prefix}**${title}**\n${prefix}` : "";
      return `${prefix}[!${gfmType}]${titleLine}`;
    },
  );
  return result;
}

// ---------------------------------------------------------------------------

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

  it("converts note embeds to italic references", () => {
    expect(preprocessObsidian("![[My Note#Section]]")).toBe("*See: My Note#Section*");
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
