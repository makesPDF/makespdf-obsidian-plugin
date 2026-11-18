/**
 * The user's sample Vtable block, verbatim.
 *
 * Copied from the makesPDF repo's `docs/obsidian-plugin-formats.md` ("The
 * user's sample (2026-11-01, created in Obsidian on Android), shortened to
 * its first three rows"), which is the fixture the task names. It uses only
 * column spans and a `colWidths` hint of `[621,120]`.
 *
 * A TypeScript module rather than a file read so the fixture ships with the
 * tests wherever they run; nothing imports it from `main.ts`.
 */
export const VTABLE_SAMPLE =
  '{"rows":[[{"t":"Example merged cell 1","rs":1,"cs":2,"a":"c"},{"t":"","rs":0,"cs":0}],[{"t":"Example merged cell 2","rs":1,"cs":2,"a":"c"},{"t":"","rs":0,"cs":0}],[{"t":"Example cell left 1","rs":1,"cs":1,"a":"c"},{"t":"Example cell right 1","rs":1,"cs":1,"a":"c"}]],"colWidths":[621,120]}';
