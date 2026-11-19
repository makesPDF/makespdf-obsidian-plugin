/**
 * Tests for the fenced-block scanner and its two consumers' shared rules.
 */
import { describe, it, expect } from "vitest";

import {
  indentLines,
  mapOutsideFencedBlocks,
  replaceFencedBlocks,
  scanFencedBlocks,
  type FencedBlock,
} from "./fenced-blocks";

describe("scanFencedBlocks", () => {
  it("finds a block's offsets, info string and source", () => {
    const md = "before\n```vtable\n{\"rows\":[]}\n```\nafter";
    const blocks = scanFencedBlocks(md);

    expect(blocks).toHaveLength(1);
    const [block] = blocks;
    expect(block.fence).toBe("vtable");
    expect(block.info).toBe("vtable");
    expect(block.source).toBe('{"rows":[]}\n');
    expect(md.slice(block.from, block.to)).toBe("```vtable\n{\"rows\":[]}\n```\n");
  });

  it("takes only the first word of the info string, lower-cased", () => {
    const blocks = scanFencedBlocks("```JS title=\"a.js\"\nx\n```");
    expect(blocks[0].fence).toBe("js");
    expect(blocks[0].info).toBe('JS title="a.js"');
  });

  it("accepts tilde fences and a longer closing fence", () => {
    const md = "~~~vtable\na\n~~~\n\n````vtable\nb\n`````\n";
    const blocks = scanFencedBlocks(md);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].source).toBe("a\n");
    expect(blocks[1].source).toBe("b\n");
  });

  it("does not close on a shorter fence or a different character", () => {
    const md = "````md\n```\n~~~\nstill code\n````\n";
    const blocks = scanFencedBlocks(md);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].source).toBe("```\n~~~\nstill code\n");
  });

  it("ignores a fence indented by four or more spaces", () => {
    expect(scanFencedBlocks("    ```js\n    x\n    ```\n")).toHaveLength(0);
  });

  it("keeps up to three spaces of indentation and reports it", () => {
    const md = "- item\n\n  ```vtable\n  x\n  ```\n";
    const [block] = scanFencedBlocks(md);
    expect(block.indent).toBe("  ");
    expect(block.source).toBe("  x\n");
  });

  it("treats an unclosed fence as running to the end of the document", () => {
    const md = "before\n```vtable\n{\"rows\":[[{\"t\":\"a\"}]]}\n";
    const [block] = scanFencedBlocks(md);
    expect(block.to).toBe(md.length);
    expect(block.source).toBe('{"rows":[[{"t":"a"}]]}\n');
  });

  it("ignores an inline backtick run and a fence with a backtick in its info", () => {
    expect(scanFencedBlocks("a ``` b ``` c")).toHaveLength(0);
    // The odd first line is not a fence (a backtick fence's info string may
    // not hold a backtick); the bare fence on line 3 then opens one.
    const blocks = scanFencedBlocks("```a`b\nx\n```\n");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].info).toBe("");
    // It is the bare fence on line 3 that opens, unclosed to the end.
    expect(blocks[0].source).toBe("");
  });

  it("finds several blocks and bare fences", () => {
    const blocks = scanFencedBlocks("```\na\n```\ntext\n```vtable\nb\n```");
    expect(blocks).toHaveLength(2);
    expect(blocks[0].fence).toBe("");
    expect(blocks[1].fence).toBe("vtable");
  });

  it("handles CRLF line endings", () => {
    const [block] = scanFencedBlocks("```vtable\r\nx\r\n```\r\n");
    expect(block.info).toBe("vtable");
    expect(block.source).toBe("x\r\n");
  });

  it("does not scan the YAML front matter", () => {
    // A block scalar holding an unbalanced fence must not open a block over
    // the note body: the engine strips the front matter before rendering.
    const md =
      "---\nsample: |\n  ```js\n  const a = 1;\n---\n\n# Title\n[[Page]] and #tag\n";
    expect(scanFencedBlocks(md)).toHaveLength(0);

    // A real fence after the front matter is still found, at absolute offsets.
    const withBlock = "---\nkey: value\n---\n\n```vtable\nx\n```\n";
    const [block] = scanFencedBlocks(withBlock);
    expect(block.from).toBe(withBlock.indexOf("```vtable"));
    expect(block.source).toBe("x\n");
  });
});

describe("replaceFencedBlocks", () => {
  it("replaces a block and leaves the surrounding text alone", () => {
    const md = "before\n```vtable\nx\n```\nafter\n";
    expect(
      replaceFencedBlocks(md, (block) =>
        block.fence === "vtable" ? "<table></table>\n" : null,
      ),
    ).toBe("before\n<table></table>\nafter\n");
  });

  it("keeps a block when the replacer returns null", () => {
    const md = "```vtable\nnot json\n```";
    expect(replaceFencedBlocks(md, () => null)).toBe(md);
  });

  it("does not rescan a replacement's own fences", () => {
    const md = "```a\nx\n```\n";
    const seen: FencedBlock[] = [];
    const out = replaceFencedBlocks(md, (block) => {
      seen.push(block);
      return "```a\nreplaced\n```\n";
    });
    expect(seen).toHaveLength(1);
    expect(out).toBe("```a\nreplaced\n```\n");
  });
});

describe("mapOutsideFencedBlocks", () => {
  it("transforms only the text outside a fence", () => {
    const md = "a\n```js\nb\n```\nc\n";
    expect(mapOutsideFencedBlocks(md, (text) => text.toUpperCase())).toBe(
      "A\n```js\nb\n```\nC\n",
    );
  });

  it("transforms the whole document when there is no fence", () => {
    expect(mapOutsideFencedBlocks("a\nb\n", (text) => text.toUpperCase())).toBe("A\nB\n");
  });

  it("leaves an unclosed fence and everything after it alone", () => {
    const md = "before\n```js\nafter\n";
    expect(mapOutsideFencedBlocks(md, (text) => text.toUpperCase())).toBe(
      "BEFORE\n```js\nafter\n",
    );
  });
});

describe("indentLines", () => {
  it("indents non-empty lines and leaves empty ones empty", () => {
    expect(indentLines("a\n\nb\n", "  ")).toBe("  a\n\n  b\n");
  });

  it("is a no-op without indentation", () => {
    expect(indentLines("a\n", "")).toBe("a\n");
  });
});
