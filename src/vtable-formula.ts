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
 * ignored by the aggregates, as a spreadsheet ignores text in a SUM, but a
 * cell whose own formula failed fails the aggregate rather than dropping out
 * of a total that would then look right.
 *
 * Kept free of the `obsidian` import and unit-tested directly (see
 * vtable-formula.test.ts).
 */

/**
 * A cell reference that failed to compute: it holds a formula whose value is
 * invalid, or one that is cyclic. Distinct from null, which is a blank or text
 * cell an aggregate ignores, so a range can tell "nothing to add" from "the
 * total would be wrong".
 */
export const FORMULA_ERROR: unique symbol = Symbol("formula-error");

/** What reading a cell yields: a number, no number, or a failed formula. */
export type CellResult = number | null | typeof FORMULA_ERROR;

/** A 1-based cell reference resolved to a number, null, or a failure. */
export type CellReader = (row: number, column: number) => CellResult;

/**
 * Deepest parser nesting accepted. Each parenthesis, function call or unary
 * sign is one level, so this is far beyond any real formula while keeping a
 * pathological one (`((((...1...))))`) from exhausting the stack.
 */
const MAX_FORMULA_DEPTH = 100;

/** Longest formula accepted, so tokenising a huge string stays linear-ish. */
const MAX_FORMULA_LENGTH = 10_000;

/**
 * Most cells one range may expand to: the engine's own table cap. A range
 * naming more is a mistake (or an attack) and fails instead of allocating a
 * huge array.
 */
const MAX_RANGE_CELLS = 5_000;

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

/** A parsed argument: one value, or the cells a range expands to. */
type Argument =
  | { kind: "value"; value: number | null }
  | { kind: "cells"; values: CellResult[] };

/**
 * A recursive-descent parser over the token list. Every method returns null
 * on anything it does not understand; a null anywhere makes the whole
 * formula fail, which the adapter reports as text.
 */
class FormulaParser {
  private position = 0;
  private depth = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly read: CellReader,
  ) {}

  atEnd(): boolean {
    return this.position >= this.tokens.length;
  }

  /** Run one nesting level of parsing, failing rather than overflowing. */
  private nested<T>(parse: () => T | null): T | null {
    if (this.depth >= MAX_FORMULA_DEPTH) return null;
    this.depth++;
    try {
      return parse();
    } finally {
      this.depth--;
    }
  }

  /** `expr := term (('+'|'-') term)*` */
  expression(): number | null {
    return this.nested(() => {
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
    });
  }

  /** `term := factor (('*'|'/') factor)*` */
  private term(): number | null {
    return this.nested(() => {
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
    });
  }

  /** `factor := ('+'|'-')? primary` */
  private factor(): number | null {
    return this.nested(() => {
      const token = this.tokens[this.position];
      if (token && token.kind === "char" && (token.value === "+" || token.value === "-")) {
        this.position++;
        const value = this.factor();
        if (value === null) return null;
        return token.value === "-" ? -value : value;
      }
      return this.primary();
    });
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
      // A failed referenced formula fails this one too; a text cell read on
      // its own already yields null.
      const value = this.read(token.row, token.column);
      return typeof value === "number" ? value : null;
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
      const values: CellResult[] = [];
      const rowFrom = Math.min(start.row, after.row);
      const rowTo = Math.max(start.row, after.row);
      const columnFrom = Math.min(start.column, after.column);
      const columnTo = Math.max(start.column, after.column);
      if ((rowTo - rowFrom + 1) * (columnTo - columnFrom + 1) > MAX_RANGE_CELLS) {
        return null;
      }
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

/**
 * The numeric values an argument contributes, skipping blanks and text. Null
 * means the argument contains a failed formula, so the caller must fail too
 * rather than return a plausible total over the surviving numbers.
 */
function numbersOf(argument: Argument): number[] | null {
  const values: CellResult[] =
    argument.kind === "value"
      ? argument.value === null
        ? []
        : [argument.value]
      : argument.values;

  const numbers: number[] = [];
  for (const value of values) {
    if (value === FORMULA_ERROR) return null;
    if (value !== null) numbers.push(value);
  }
  return numbers;
}

/** Apply a supported function; an unknown name fails the formula. */
function applyFunction(name: string, args: Argument[]): number | null {
  const numbers: number[] = [];
  for (const argument of args) {
    const values = numbersOf(argument);
    if (values === null) return null;
    numbers.push(...values);
  }

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
      // A scalar function takes one value, not a range: a range here is a
      // mistake, and taking its first number would silently hide it.
      if (args.length !== 1 || args[0].kind !== "value") return null;
      const value = args[0].value;
      return value === null ? null : Math.abs(value);
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
  if (source.length > MAX_FORMULA_LENGTH) return null;

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
