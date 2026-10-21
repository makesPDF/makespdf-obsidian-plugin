/**
 * How a failed render response is shown in the error notice.
 *
 * Kept free of the `obsidian` import so the notice rules are unit-testable;
 * `main.ts` only draws the result. The server's bodies are described in
 * makesPDF `apps/web/src/server/anonymous-rate-limits.server.ts`.
 *
 * The displayed text and the feedback context are kept apart deliberately:
 * `message` is a full, server-authored sentence and may be shown, but
 * `feedback.ts` forwards only a code-shaped `error` value, so the sentence
 * never reaches the feedback payload.
 */

import { asErrorCode } from "./feedback";

/** The parts of a failed render body this plugin reads. */
export interface RenderErrorBody {
  /** Short machine-readable code, e.g. `page-cap-exceeded`. */
  error?: string;
  /** Human-readable explanation; safe to display (server-authored, no note content). */
  message?: string;
  /** Page cap that was hit, when `error` is `page-cap-exceeded`. */
  limit?: number;
  /** Pages the server actually rendered, when `error` is `page-cap-exceeded`. */
  actual?: number;
}

/** Shown for anonymous failures the API key removes. Same wording on every path. */
export const API_KEY_HINT = "Add an API key in the MakesPDF settings for higher limits.";

export interface RenderFailure {
  /** Notice text: the server's `message`, else `error`, else `HTTP <status>`, plus the hint when due. */
  message: string;
  /** The code-shaped `error` value for the feedback context; never a sentence. */
  errorCode?: string;
  /** The notice also offers a link to the plugin settings tab where the API key is set. */
  offerSettingsLink: boolean;
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Read a failed render body once. A non-JSON body, or one whose fields have
 * the wrong types, yields an empty body rather than throwing.
 */
export function parseRenderErrorBody(bodyText: string): RenderErrorBody {
  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return {};
  }
  if (typeof body !== "object" || body === null) return {};

  const record = body as Record<string, unknown>;
  const parsed: RenderErrorBody = {};
  const error = nonEmpty(record.error);
  if (error !== undefined) parsed.error = error;
  const message = nonEmpty(record.message);
  if (message !== undefined) parsed.message = message;
  const limit = optionalNumber(record.limit);
  if (limit !== undefined) parsed.limit = limit;
  const actual = optionalNumber(record.actual);
  if (actual !== undefined) parsed.actual = actual;
  return parsed;
}

/**
 * The `error` value counts as a code only when it is code-shaped. A server 500
 * carries a raw exception message there, which may quote request content, so
 * it is showable but must not be forwarded to the feedback payload.
 */
function withHint(text: string, hint: string): string {
  // The page-cap `message` is a sentence and already ends in a period; a
  // code-shaped `error` does not. Neither should produce ".." or "rate-limited Add".
  return /[.!?]$/.test(text) ? `${text} ${hint}` : `${text}. ${hint}`;
}

/**
 * The page counts the server sends with `page-cap-exceeded`, for the case
 * where it sends no `message` sentence. Mirrors makespdf-vscode-plugin, which
 * spells the same figures out as "(42 pages, cap 20)".
 */
function pageCapDetail(body: RenderErrorBody): string | undefined {
  if (body.error !== "page-cap-exceeded") return undefined;
  if (body.limit === undefined || body.actual === undefined) return undefined;
  return `${body.actual} pages, cap ${body.limit}`;
}

/** What the notice says before the hint: the server's sentence, else its code (with page counts), else the status. */
function failureText(status: number, body: RenderErrorBody): string {
  if (body.message !== undefined) return body.message;
  if (body.error === undefined) return `HTTP ${status}`;
  const detail = pageCapDetail(body);
  return detail ? `${body.error} (${detail})` : body.error;
}

/**
 * Describe a non-200 render response for the user. `message` wins over the
 * bare code because it is the server explaining itself; the code remains the
 * fallback and, when code-shaped, the only part the feedback payload receives.
 *
 * The API-key hint is offered whenever the user's anonymous request could be
 * fixed by a key: the page cap (a 400) and the rate-limit / size limits
 * (429 / 413). The settings link rides with the hint, so every notice that
 * tells the user to add a key in the settings also offers a way there.
 */
export function describeRenderFailure(args: {
  status: number;
  bodyText: string;
  hasApiKey: boolean;
}): RenderFailure {
  const body = parseRenderErrorBody(args.bodyText);
  const errorCode = asErrorCode(body.error);
  const pageCapExceeded = errorCode === "page-cap-exceeded";

  const text = failureText(args.status, body);
  const hintApplies =
    !args.hasApiKey && (pageCapExceeded || args.status === 429 || args.status === 413);

  return {
    message: hintApplies ? withHint(text, API_KEY_HINT) : text,
    errorCode,
    offerSettingsLink: hintApplies,
  };
}
