/**
 * The Structural Tables fixtures for MAK-351.
 *
 * The task names one table from the makesPDF repo's `assets/issues/Ahriman.md`:
 * four data rows that use `<` only, with `:---:` alignment on every column.
 * The note in the makesPDF checkout carried no table when this adapter was
 * built, so the shape recorded here is the task's description of it, kept as
 * the export fixture.
 *
 * A second fixture exercises `^`: a row span is one thing the Ahriman table
 * does not cover.
 *
 * TypeScript modules rather than files read at test time, matching
 * `vtable-sample.ts`: the fixtures ship with the tests wherever they run.
 */

/** Four `<` rows, all columns centred: the MAK-351 Ahriman fixture. */
export const AHRIMAN_STRUCTURAL_TABLE = [
  "| Script | Sample |  | Direction |",
  "| :---: | :---: | :---: | :---: |",
  "| Avestan | Ahuna Vairya | < | Right to left |",
  "| Pahlavi | Dura-Europos | < | Right to left |",
  "| Hebrew | Unpointed | < | Right to left |",
  "| Arabic | Out of scope | < | Right to left |",
].join("\n");

/** A `^` fixture: North spans its two quarterly rows. */
export const ROWSPAN_STRUCTURAL_TABLE = [
  "| Region | Sales | Quarter |",
  "| :--- | :---: | :---: |",
  "| North | 10 | Q1 |",
  "| ^ | 12 | Q2 |",
  "| South | 9 | Q1 |",
].join("\n");
