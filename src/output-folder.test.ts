/**
 * Tests for output-folder validation.
 */
import { describe, it, expect } from "vitest";

import { outputFolderError } from "./output-folder";

describe("outputFolderError", () => {
  it("accepts an empty value (save alongside the note)", () => {
    expect(outputFolderError("")).toBeUndefined();
    expect(outputFolderError("   ")).toBeUndefined();
  });

  it("accepts vault-relative folders", () => {
    expect(outputFolderError("Downloads")).toBeUndefined();
    expect(outputFolderError("exports/pdf")).toBeUndefined();
    expect(outputFolderError("a/b/c")).toBeUndefined();
  });

  it("rejects a home-relative path, which Obsidian does not expand", () => {
    // Regression: "~/Downloads" used to create a literal "~" folder in the vault.
    expect(outputFolderError("~/Downloads")).toMatch(/not expanded/);
    expect(outputFolderError("~")).toMatch(/not expanded/);
  });

  it("rejects an absolute path", () => {
    expect(outputFolderError("/Users/someone/Downloads")).toMatch(/without a leading slash/);
  });

  it("rejects traversal out of the vault", () => {
    expect(outputFolderError("../outside")).toMatch(/stay inside your vault/);
    expect(outputFolderError("a/../../outside")).toMatch(/stay inside your vault/);
  });

  it("does not reject a folder name that merely contains the traversal characters", () => {
    expect(outputFolderError("my..notes")).toBeUndefined();
    expect(outputFolderError("a~b")).toBeUndefined();
  });
});
