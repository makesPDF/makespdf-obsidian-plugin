/**
 * Tests for the vtable formula evaluator: arithmetic, references, ranges,
 * aggregates, and the fail-closed cases the adapter shows as text.
 */
import { describe, it, expect } from "vitest";

import { evaluateFormula, formatFormulaValue } from "./vtable-formula";

/** A reader over a small numeric grid: rows are 1-based cell rows. */
function grid(values: (number | null)[][]): (row: number, column: number) => number | null {
  return (row, column) => values[row]?.[column] ?? null;
}

const SMALL = grid([
  [10, 20],
  [2, 3],
  [4, 5],
]);

describe("evaluateFormula", () => {
  it("evaluates a number", () => {
    expect(evaluateFormula("=42", SMALL)).toBe(42);
    expect(evaluateFormula("3.5", SMALL)).toBe(3.5);
  });

  it("follows arithmetic precedence and parentheses", () => {
    expect(evaluateFormula("=1+2*3", SMALL)).toBe(7);
    expect(evaluateFormula("=(1+2)*3", SMALL)).toBe(9);
    expect(evaluateFormula("=10-4/2", SMALL)).toBe(8);
    expect(evaluateFormula("=-(2+3)", SMALL)).toBe(-5);
  });

  it("resolves cell references", () => {
    expect(evaluateFormula("=A1", SMALL)).toBe(10);
    expect(evaluateFormula("=B2", SMALL)).toBe(3);
    expect(evaluateFormula("=A3+B1", SMALL)).toBe(24);
  });

  it("resolves a two-letter column", () => {
    const wide = (row: number, column: number) => (row === 0 && column === 26 ? 9 : null);
    expect(evaluateFormula("=AA1", wide)).toBe(9);
  });

  it("applies aggregates over a range", () => {
    expect(evaluateFormula("=SUM(A2:A3)", SMALL)).toBe(6);
    expect(evaluateFormula("=AVERAGE(A2:A3)", SMALL)).toBe(3);
    expect(evaluateFormula("=AVG(A2:A3)", SMALL)).toBe(3);
    expect(evaluateFormula("=MIN(A2:B3)", SMALL)).toBe(2);
    expect(evaluateFormula("=MAX(A2:B3)", SMALL)).toBe(5);
    expect(evaluateFormula("=COUNT(A1:B3)", SMALL)).toBe(6);
  });

  it("accepts several arguments and nested calls", () => {
    expect(evaluateFormula("=SUM(A2, A3, 10)", SMALL)).toBe(16);
    expect(evaluateFormula("=MAX(SUM(A2:A3), 5)", SMALL)).toBe(6);
    expect(evaluateFormula("=ABS(2-10)", SMALL)).toBe(8);
  });

  it("skips blank cells in aggregates, as a spreadsheet ignores text", () => {
    const sparse = grid([[1, null], [2, null]]);
    expect(evaluateFormula("=SUM(A1:B2)", sparse)).toBe(3);
    expect(evaluateFormula("=COUNT(A1:B2)", sparse)).toBe(2);
  });

  it("fails a direct reference to a cell with no number", () => {
    expect(evaluateFormula("=B1", grid([[null]]))).toBeNull();
  });

  it("fails division by zero", () => {
    expect(evaluateFormula("=10/0", SMALL)).toBeNull();
  });

  it("fails an unknown function", () => {
    expect(evaluateFormula("=NOTAFUNCTION(1)", SMALL)).toBeNull();
  });

  it("fails an empty or malformed formula", () => {
    expect(evaluateFormula("", SMALL)).toBeNull();
    expect(evaluateFormula("=", SMALL)).toBeNull();
    expect(evaluateFormula("=1+", SMALL)).toBeNull();
    expect(evaluateFormula("=(1", SMALL)).toBeNull();
    expect(evaluateFormula("=1 2", SMALL)).toBeNull();
    expect(evaluateFormula("=$A$1", SMALL)).toBeNull();
  });

  it("fails a range used outside a function", () => {
    expect(evaluateFormula("=A1:A3", SMALL)).toBeNull();
  });

  it("fails a reference to a cell outside the grid", () => {
    expect(evaluateFormula("=Z99", SMALL)).toBeNull();
  });
});

describe("formatFormulaValue", () => {
  it("writes integers plainly and trims float noise", () => {
    expect(formatFormulaValue(5)).toBe("5");
    expect(formatFormulaValue(2.5)).toBe("2.5");
    expect(formatFormulaValue(0.1 + 0.2)).toBe("0.3");
    expect(formatFormulaValue(-4)).toBe("-4");
  });
});
