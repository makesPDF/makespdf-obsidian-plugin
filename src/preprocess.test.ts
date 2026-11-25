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

  it("strips a comment that encloses a fenced code block", () => {
    const input = "before\n%%\n```js\nconst a = 1;\n```\n%%\nafter\n";
    expect(preprocessObsidian(input)).toBe("before\n\nafter\n");
  });

  it("strips a commented-out fence even when no adapter translated it", () => {
    const input = "%%\n```vtable\n{\"rows\":[]}\n```\n%%\n";
    // Only the markers and their span go; the newline after the closer stays,
    // exactly as the comment rule did before fences were protected.
    expect(preprocessObsidian(input)).toBe("\n");
  });

  it("leaves an unmatched comment marker as text", () => {
    expect(preprocessObsidian("50%% done")).toBe("50%% done");
    const unclosed = "%%a fence\n```js\nlet a = 1;\n```\n";
    expect(preprocessObsidian(unclosed)).toBe(unclosed);
  });

  it("strips block reference IDs", () => {
    expect(preprocessObsidian("Some paragraph ^abc-123")).toBe("Some paragraph");
  });

  it("keeps block reference IDs when asked (canvas note text)", () => {
    expect(preprocessObsidian("Some paragraph ^abc-123", { keepBlockIds: true })).toBe(
      "Some paragraph ^abc-123",
    );
    // Everything else still converts.
    expect(
      preprocessObsidian("para ^abc-123\n\n[[Page]]", { keepBlockIds: true }),
    ).toBe("para ^abc-123\n\nPage");
  });

  it("writes an image embed's file name as an angle-bracket destination", () => {
    expect(preprocessObsidian("![[a (b).jpg]]")).toBe("![a (b).jpg](<a (b).jpg>)");
  });

  it("escapes angle brackets in an image embed's file name", () => {
    // The file name is both the implicit alt and the destination, and neither
    // may be read as markup by a later pass.
    expect(preprocessObsidian("![[a<b>c.jpg]]")).toBe("![a\\<b\\>c.jpg](<a\\<b\\>c.jpg>)");
  });

  it("escapes an implicit alt and destination so later rules cannot rewrite them", () => {
    // Unescaped, rule 6 turned both slots into `a<mark>b</mark>.png` and the
    // inliner could no longer resolve the file.
    expect(preprocessObsidian("![[a==b==.png]]")).toBe(
      "![a\\=\\=b\\=\\=.png](<a\\=\\=b\\=\\=.png>)",
    );
  });

  it("reads a table-escaped pipe on an image embed", () => {
    // Inside a GFM table a pipe has to be written `\|`; it is the table's
    // escape, not part of the path or the display text.
    expect(preprocessObsidian(String.raw`| ![[photo.png\|alt text]] |`)).toBe(
      "| ![alt text](<photo.png>) |",
    );
    expect(preprocessObsidian(String.raw`| ![[photo.png\|400]] |`)).toBe(
      '| <img src="photo.png" width="400" alt="photo.png"> |',
    );
    // The separator before the size is escaped the same way.
    expect(preprocessObsidian(String.raw`| ![[photo.png\|alt text\|400]] |`)).toBe(
      '| <img src="photo.png" width="400" alt="alt text"> |',
    );
  });

  it("escapes the file name in a sized embed's src and implicit alt", () => {
    expect(preprocessObsidian("![[a>b.png|300]]")).toBe(
      '<img src="a&gt;b.png" width="300" alt="a&gt;b.png">',
    );
  });

  it("converts sized standard images with an unbalanced parenthesis", () => {
    expect(preprocessObsidian("![logo|200](a(b.png)")).toBe(
      '<img src="a(b.png" width="200" alt="logo">',
    );
  });

  it("converts sized standard images whose path holds parentheses", () => {
    expect(preprocessObsidian("![logo|200](a(b).png)")).toBe(
      '<img src="a(b).png" width="200" alt="logo">',
    );
    expect(preprocessObsidian("![logo|200](<a (b).png>)")).toBe(
      '<img src="a (b).png" width="200" alt="logo">',
    );
  });

  it("converts image embeds", () => {
    expect(preprocessObsidian("![[photo.png]]")).toBe("![photo.png](<photo.png>)");
    expect(preprocessObsidian("![[photo.png|300]]")).toBe(
      '<img src="photo.png" width="300" alt="photo.png">',
    );
    expect(preprocessObsidian("![[photo.png|300x200]]")).toBe(
      '<img src="photo.png" width="300" height="200" alt="photo.png">',
    );
  });

  it("turns a non-numeric pipe on an image embed into alt text", () => {
    // Obsidian 1.13.7 reads the pipe the same way: `$E` splits the display
    // text off, and the `iembed` transformer sets it as the image's alt when
    // `NT` does not parse it as a size. The image renders at natural size.
    expect(preprocessObsidian("![[photo.png|alt text]]")).toBe(
      "![alt text](<photo.png>)",
    );
    // A pipe followed by a number and letters is not a size either.
    expect(preprocessObsidian("![[photo.png|300px]]")).toBe("![300px](<photo.png>)");
  });

  it("escapes alt text so it prints verbatim", () => {
    // A bracket, a highlight, a tag and an entity all reached a later rule
    // before: the alt must print as written, not turn into markup.
    expect(preprocessObsidian("![[photo.png|see [1] here]]")).toBe(
      "![see \\[1\\] here](<photo.png>)",
    );
    expect(preprocessObsidian("![[photo.png|a==b== #tag Tom & Jerry]]")).toBe(
      "![a\\=\\=b\\=\\= \\#tag Tom \\& Jerry](<photo.png>)",
    );
  });

  it("converts an image embed that is both sized and given alt text", () => {
    // Obsidian's grammar puts the size last: `|alt|300`.
    expect(preprocessObsidian("![[photo.png|alt text|300]]")).toBe(
      '<img src="photo.png" width="300" alt="alt text">',
    );
    expect(preprocessObsidian("![[photo.png|alt text|300x200]]")).toBe(
      '<img src="photo.png" width="300" height="200" alt="alt text">',
    );
    // In an attribute the escape set is written as character references.
    expect(preprocessObsidian("![[photo.png|a==b== [1]|300]]")).toBe(
      '<img src="photo.png" width="300" alt="a&#61;&#61;b&#61;&#61; &#91;1&#93;">',
    );
  });

  it("reads a size only from the last pipe segment, as Obsidian does", () => {
    // `|300|alt` is the alt text `300|alt`, not a size: a non-trailing size
    // is not a size at all.
    expect(preprocessObsidian("![[photo.png|300|alt]]")).toBe(
      "![300|alt](<photo.png>)",
    );
    // Obsidian's size parser tolerates spaces around the x.
    expect(preprocessObsidian("![[photo.png| 300 x 200 ]]")).toBe(
      '<img src="photo.png" width="300" height="200" alt="photo.png">',
    );
    // A zero height is no height, as in Obsidian's `NT`.
    expect(preprocessObsidian("![[photo.png|300x0]]")).toBe(
      '<img src="photo.png" width="300" alt="photo.png">',
    );
  });

  it("keeps an empty pipe equivalent to a plain embed", () => {
    expect(preprocessObsidian("![[photo.png|]]")).toBe("![photo.png](<photo.png>)");
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

  it("escapes the alt and the destination of the resize syntax in the <img> form", () => {
    // Both land in an attribute; an unescaped `>` ends the tag inside the alt.
    expect(preprocessObsidian("![a>b|300](x.png)")).toBe(
      '<img src="x.png" width="300" alt="a&gt;b">',
    );
    expect(preprocessObsidian("![logo|200x100](a&b.png)")).toBe(
      '<img src="a&amp;b.png" width="200" height="100" alt="logo">',
    );
  });

  it("converts tags to inline code", () => {
    expect(preprocessObsidian("some text #project")).toBe("some text `#project`");
    expect(preprocessObsidian("tagged #nested/tag here")).toBe(
      "tagged `#nested/tag` here",
    );
  });

  it("leaves a colour inside an HTML tag's attribute alone", () => {
    const input = '<td style="background-color: #f6f8fa">x</td> #tag';
    expect(preprocessObsidian(input)).toBe(
      '<td style="background-color: #f6f8fa">x</td> `#tag`',
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

  it("keeps callout titles on the marker line", () => {
    expect(preprocessObsidian("> [!tip] My Custom Title\n> content")).toBe(
      "> [!TIP] My Custom Title\n>\n> content",
    );
    expect(preprocessObsidian("> [!info] Informasi\n> **Example**")).toBe(
      "> [!NOTE] Informasi\n>\n> **Example**",
    );
    expect(preprocessObsidian("> [!attention]- Perhatian!\n> body")).toBe(
      "> [!WARNING] Perhatian!\n>\n> body",
    );
    // The blank quoted line keeps a `---` body from turning the title line
    // into a setext heading.
    expect(preprocessObsidian("> [!tip] Title\n> ---\n> body")).toBe(
      "> [!TIP] Title\n>\n> ---\n> body",
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
    expect(output).toContain("[!CAUTION] Security Issue");

    // Block ref stripped
    expect(output).not.toContain("^ref-1");

    // Tags as inline code
    expect(output).toContain("`#project`");
    expect(output).toContain("`#status/active`");
  });

  it("leaves the inside of a fenced code block alone", () => {
    const input = [
      "outside [[Page]] and ==highlight== and #tag and %%comment%%",
      "```md",
      "inside [[Page]] and ==highlight== and #tag and %%comment%% ^block-1",
      "```",
      "outside again [[Other]]",
    ].join("\n");

    expect(preprocessObsidian(input)).toBe(
      [
        "outside Page and <mark>highlight</mark> and `#tag` and ",
        "```md",
        "inside [[Page]] and ==highlight== and #tag and %%comment%% ^block-1",
        "```",
        "outside again Other",
      ].join("\n"),
    );
  });

  it("leaves a vtable block alone so invalid JSON still prints as code", () => {
    const input = '```vtable\n{"rows": [[{"t": "[[not a link]] #notatag"}]]}\n```';

    expect(preprocessObsidian(input)).toBe(input);
  });

  it("protects tilde fences and a fence to the end of the document", () => {
    expect(preprocessObsidian("~~~\n[[Page]] #tag\n~~~")).toBe(
      "~~~\n[[Page]] #tag\n~~~",
    );
    expect(preprocessObsidian("before [[Page]]\n```\n[[Page]] #tag")).toBe(
      "before Page\n```\n[[Page]] #tag",
    );
  });

  it("still converts text around a fence and inside a translated block", () => {
    const input = "[[Page]]\n```vtable\n{}\n```\n#tag";
    expect(preprocessObsidian(input)).toBe(
      "Page\n```vtable\n{}\n```\n`#tag`",
    );
  });

  it("converts the body when the front matter holds an unbalanced fence", () => {
    const input =
      "---\nsample: |\n  ```js\n  const a = 1;\n---\n\n# Title\n[[Page]] and #tag\n";

    const output = preprocessObsidian(input);

    expect(output).toContain("Page and `#tag`");
    expect(output).toContain("```js");
  });
});
