/**
 * Formula evaluation for the vtable adapter.
 *
 * Vtable stores a formula cell as the formula only (`{"f": "=SUM(A1:A3)"}`),
 * so the value has to be computed before the table is sent to the engine: the
 * engine never sees another plugin's format, and it has no formula support.
 *
 * The supported subset is deliberately small and fail-closed: arithmetic
 * (`+ - * /`, parentheses, unary signs), cell references (`A1`, `AB12`),
 * ranges inside an aggregate, and `SUM`, `AVERAGE`/`AVG`, `MIN`, `MAX`,
 * `COUNT` and `ABS`. Anything else returns null, and the adapter shows the
 * formula's source text instead of inventing a value. Non-numeric cells are
 * ignored by the aggregates, as a spreadsheet ignores text in a SUM.
 *
 * Kept free of the `obsidian` import and unit-tested directly (see
 * vtable-formula.test.ts).
 */

/** A 1-based cell reference resolved to a number, or null when it has none. */
export type CellReader = (row: number, column: number) => number | null;

/** A token: a number, a cell reference, an identifier or one character. */
type Token =
  | { kind: "number"; value: number }
  | { kind: "ref"; row: number; column: number }
  | { kind: "name"; value: string }
  | { kind: "char"; value: string };

/** Column letters to a zero-based index: A=0, Z=25, AA=26. */
function columnIndex(letters: string): number {
  let index = 0;
  for (const char of letters.toUpperCase()) {
    index = index * 26 + (char.charCodeAt(0) - 64);
  }
  return index - 1;
}

/** `A1` -> row 0, column 0. */
function cellReference(letters: string, digits: string): { row: number; column: number } {
  return {
    row: parseInt(digits, 10) - 1,
    column: columnIndex(letters),
  };
}

/**
 * Tokenise the formula after the optional leading `=`. A cell reference is
 * recognised as letters followed by digits, so `SUM` stays a function name
 * and `A1` becomes a reference.
 */
function tokenize(source: string): Token[] | null {
  const tokens: Token[] = [];
  let i = 0;

  while (i < source.length) {
    const char = source[i];

    if (/\s/.test(char)) {
      i++;
      continue;
    }

    const number = /^\d+(?:\.\d+)?/.exec(source.slice(i));
    if (number) {
      tokens.push({ kind: "number", value: Number(number[0]) });
      i += number[0].length;
      continue;
    }

    const ref = /^([A-Za-z]+)(\d+)/.exec(source.slice(i));
    if (ref) {
      const { row, column } = cellReference(ref[1], ref[2]);
      tokens.push({ kind: "ref", row, column });
      i += ref[0].length;
      continue;
    }

    const name = /^[A-Za-z]+/.exec(source.slice(i));
    if (name) {
      tokens.push({ kind: "name", value: name[0].toUpperCase() });
      i += name[0].length;
      continue;
    }

    if ("()+-*/,:".includes(char)) {
      tokens.push({ kind: "char", value: char });
      i++;
      continue;
    }

    return null;
  }

  return tokens;
}

/** A parsed argument: one value, or the values a range expands to. */
type Argument =
  | { kind: "value"; value: number | null }
  | { kind: "cells"; values: (number | null)[] };

/**
 * A recursive-descent parser over the token list. Every method returns null
 * on anything it does not understand; a null anywhere makes the whole
 * formula fail, which the adapter reports as text.
 */
class FormulaParser {
  private position = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly read: CellReader,
  ) {}

  atEnd(): boolean {
    return this.position >= this.tokens.length;
  }

  /** `expr := term (('+'|'-') term)*` */
  expression(): number | null {
    let left = this.term();
    if (left === null) return null;

    for (;;) {
      const token = this.tokens[this.position];
      if (!token || token.kind !== "char" || (token.value !== "+" && token.value !== "-")) {
        return left;
      }
      this.position++;
      const right = this.term();
      if (right === null) return null;
      left = token.value === "+" ? left + right : left - right;
    }
  }

  /** `term := factor (('*'|'/') factor)*` */
  private term(): number | null {
    let left = this.factor();
    if (left === null) return null;

    for (;;) {
      const token = this.tokens[this.position];
      if (!token || token.kind !== "char" || (token.value !== "*" && token.value !== "/")) {
        return left;
      }
      this.position++;
      const right = this.factor();
      if (right === null) return null;
      if (token.value === "/") {
        if (right === 0) return null;
        left /= right;
      } else {
        left *= right;
      }
    }
  }

  /** `factor := ('+'|'-')? primary` */
  private factor(): number | null {
    const token = this.tokens[this.position];
    if (token && token.kind === "char" && (token.value === "+" || token.value === "-")) {
      this.position++;
      const value = this.factor();
      if (value === null) return null;
      return token.value === "-" ? -value : value;
    }
    return this.primary();
  }

  /** `primary := number | ref | func '(' args ')' | '(' expr ')'` */
  private primary(): number | null {
    const token = this.tokens[this.position];
    if (!token) return null;

    if (token.kind === "number") {
      this.position++;
      return token.value;
    }

    if (token.kind === "ref") {
      this.position++;
      return this.read(token.row, token.column);
    }

    if (token.kind === "name") {
      this.position++;
      return this.call(token.value);
    }

    if (token.kind === "char" && token.value === "(") {
      this.position++;
      const value = this.expression();
      if (value === null) return null;
      const close = this.tokens[this.position];
      if (!close || close.kind !== "char" || close.value !== ")") return null;
      this.position++;
      return value;
    }

    return null;
  }

  /** A function call; the opening parenthesis is the next token. */
  private call(name: string): number | null {
    const open = this.tokens[this.position];
    if (!open || open.kind !== "char" || open.value !== "(") return null;
    this.position++;

    const args: Argument[] = [];
    for (;;) {
      const argument = this.argument();
      if (argument === null) return null;
      args.push(argument);

      const next = this.tokens[this.position];
      if (next && next.kind === "char" && next.value === ",") {
        this.position++;
        continue;
      }
      if (next && next.kind === "char" && next.value === ")") {
        this.position++;
        break;
      }
      return null;
    }

    return applyFunction(name, args);
  }

  /**
   * One function argument: a range (`A1:B3`) or an expression. Ranges are
   * only meaningful to the aggregates, so using one elsewhere fails.
   */
  private argument(): Argument | null {
    const start = this.tokens[this.position];
    const next = this.tokens[this.position + 1];
    const after = this.tokens[this.position + 2];

    if (
      start &&
      start.kind === "ref" &&
      next &&
      next.kind === "char" &&
      next.value === ":" &&
      after &&
      after.kind === "ref"
    ) {
      this.position += 3;
      const values: (number | null)[] = [];
      const rowFrom = Math.min(start.row, after.row);
      const rowTo = Math.max(start.row, after.row);
      const columnFrom = Math.min(start.column, after.column);
      const columnTo = Math.max(start.column, after.column);
      for (let row = rowFrom; row <= rowTo; row++) {
        for (let column = columnFrom; column <= columnTo; column++) {
          values.push(this.read(row, column));
        }
      }
      return { kind: "cells", values };
    }

    const value = this.expression();
    return value === null ? null : { kind: "value", value };
  }
}

/** The numeric values an argument contributes, skipping blanks and text. */
function numbersOf(argument: Argument): number[] {
  if (argument.kind === "value") {
    return argument.value === null ? [] : [argument.value];
  }
  return argument.values.filter((value): value is number => value !== null);
}

/** Apply a supported function; an unknown name fails the formula. */
function applyFunction(name: string, args: Argument[]): number | null {
  const numbers = args.flatMap(numbersOf);

  switch (name) {
    case "SUM":
      return numbers.reduce((total, value) => total + value, 0);
    case "COUNT":
      return numbers.length;
    case "AVERAGE":
    case "AVG":
      if (numbers.length === 0) return null;
      return numbers.reduce((total, value) => total + value, 0) / numbers.length;
    case "MIN":
      return numbers.length === 0 ? null : Math.min(...numbers);
    case "MAX":
      return numbers.length === 0 ? null : Math.max(...numbers);
    case "ABS": {
      if (args.length !== 1) return null;
      const [value] = numbersOf(args[0]);
      return value === undefined ? null : Math.abs(value);
    }
    default:
      return null;
  }
}

/**
 * Evaluate a vtable formula against `read`, or return null when it uses
 * anything outside the supported subset (or divides by zero, or references a
 * cell with no number). The leading `=` is optional.
 */
export function evaluateFormula(source: string, read: CellReader): number | null {
  const body = source.trim().replace(/^=/, "").trim();
  if (body === "") return null;

  const tokens = tokenize(body);
  if (tokens === null || tokens.length === 0) return null;

  const parser = new FormulaParser(tokens, read);
  const value = parser.expression();
  if (value === null || !parser.atEnd() || !Number.isFinite(value)) return null;
  return value;
}

/** Render a computed value: an integer plainly, a fraction without float noise. */
export function formatFormulaValue(value: number): string {
  const rounded = Math.round(value * 1e10) / 1e10;
  return String(rounded);
}
