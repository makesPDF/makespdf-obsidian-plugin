/**
 * Feedback payloads for POST /api/v1/feedback.
 *
 * Free of the `obsidian` import so the payload rules are unit-testable; the
 * caller passes `requestUrl` in as the transport. Nothing here ever receives
 * the note text, the note path or the vault name, so nothing here can send
 * them. `context` mirrors the server's strict schema: an unknown key, a
 * non-integer or an out-of-range value there is a 400, which would lose the
 * user's message.
 */

export type FeedbackKind = "problem" | "idea" | "praise";

/** Server-side cap on `message` (trimmed). */
export const FEEDBACK_MESSAGE_MAX = 4000;

/** Fingerprint-only facts about a failed export. */
export interface ExportFailureFacts {
  /** HTTP status of the failed render call; absent when it never got a response. */
  httpStatus?: number;
  /** The response body's `error` value; only forwarded when it is code-shaped. */
  errorCode?: string;
  pageSize: string;
  /** Byte length of the Markdown that was sent: a size, never the text. */
  inputBytes: number;
}

/** The subset of the server's `context` keys this plugin fills. */
export interface FeedbackContext {
  errorCode?: string;
  httpStatus?: number;
  inputBytes?: number;
  pageSize?: string;
}

// Server limits (apps/web/src/routes/api/v1/feedback.tsx in makesPDF).
const ERROR_CODE_MAX = 64;
const PAGE_SIZE_MAX = 32;
const INPUT_BYTES_MAX = 50_000_000;

// A code, not a sentence: `page-cap-exceeded` and `rate-limited` qualify,
// "Rate limit exceeded" does not. A server 500 carries the raw exception
// message as `error`, which can quote request content, so only a code-shaped
// token is forwarded.
const ERROR_CODE_SHAPE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** `value` when it is a code-shaped token, else undefined. */
export function asErrorCode(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  if (value.length > ERROR_CODE_MAX || !ERROR_CODE_SHAPE.test(value)) return undefined;
  return value;
}

function intInRange(value: number | undefined, min: number, max: number): number | undefined {
  if (value === undefined || !Number.isInteger(value) || value < min || value > max) {
    return undefined;
  }
  return value;
}

/**
 * The `context` for a "Report problem" submission. Each field is dropped
 * rather than clamped when it falls outside the server's schema, so one odd
 * value costs one field, not the whole report.
 */
export function buildProblemContext(facts: ExportFailureFacts): FeedbackContext {
  const context: FeedbackContext = {};
  const errorCode = asErrorCode(facts.errorCode);
  if (errorCode !== undefined) context.errorCode = errorCode;
  const httpStatus = intInRange(facts.httpStatus, 0, 599);
  if (httpStatus !== undefined) context.httpStatus = httpStatus;
  const inputBytes = intInRange(facts.inputBytes, 0, INPUT_BYTES_MAX);
  if (inputBytes !== undefined) context.inputBytes = inputBytes;
  if (facts.pageSize && facts.pageSize.length <= PAGE_SIZE_MAX) context.pageSize = facts.pageSize;
  return context;
}

/** An error message for the modal, or null when the message is sendable. */
export function validateFeedbackMessage(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "Please enter a message.";
  if (trimmed.length > FEEDBACK_MESSAGE_MAX) {
    return `Please keep it under ${FEEDBACK_MESSAGE_MAX} characters (currently ${trimmed.length}).`;
  }
  return null;
}

export interface FeedbackRequestArgs {
  apiUrl: string;
  /** Plugin version, for the `X-MakesPDF-Client` header. */
  version: string;
  /** Empty when no key is configured: the request then goes anonymously. */
  apiKey: string;
  kind: FeedbackKind;
  message: string;
  /** Omitted from the body entirely when undefined. */
  context?: FeedbackContext;
}

/** The shape of obsidian's `RequestUrlParam` this module uses. */
export interface FeedbackRequest {
  url: string;
  method: "POST";
  headers: Record<string, string>;
  body: string;
  throw: false;
}

export function buildFeedbackRequest(args: FeedbackRequestArgs): FeedbackRequest {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-MakesPDF-Client": `obsidian-plugin/${args.version}`,
  };
  // An empty `Bearer ` is a failed auth attempt (401), not an anonymous request.
  if (args.apiKey) headers.Authorization = `Bearer ${args.apiKey}`;

  const body: { kind: FeedbackKind; message: string; context?: FeedbackContext } = {
    kind: args.kind,
    message: args.message.trim(),
  };
  if (args.context) body.context = args.context;

  return {
    url: `${args.apiUrl.replace(/\/+$/, "")}/api/v1/feedback`,
    method: "POST",
    headers,
    body: JSON.stringify(body),
    throw: false,
  };
}

/** The shape of obsidian's `RequestUrlResponse` this module reads. */
export interface FeedbackResponse {
  status: number;
  text: string;
}

export type FeedbackTransport = (request: FeedbackRequest) => Promise<FeedbackResponse>;

export type FeedbackResult =
  | { status: "sent" }
  | { status: "rate-limited" }
  | { status: "failed"; error: string };

/**
 * POST the feedback and classify the outcome for the UI. Never throws.
 *
 * A configured key that the server rejects (401) is retried once without
 * `Authorization`: the endpoint accepts anonymous feedback, and a rejected
 * key is one of the failures "Report problem" is offered for. Without the
 * retry, reporting a bad key would itself fail on the bad key.
 */
export async function sendFeedback(
  args: FeedbackRequestArgs,
  transport: FeedbackTransport,
): Promise<FeedbackResult> {
  let response: FeedbackResponse;
  try {
    response = await transport(buildFeedbackRequest(args));
    if (response.status === 401 && args.apiKey) {
      response = await transport(buildFeedbackRequest({ ...args, apiKey: "" }));
    }
  } catch (error) {
    return { status: "failed", error: error instanceof Error ? error.message : String(error) };
  }
  if (response.status >= 200 && response.status < 300) return { status: "sent" };
  if (response.status === 429) return { status: "rate-limited" };

  let detail = `HTTP ${response.status}`;
  try {
    const body: unknown = JSON.parse(response.text);
    if (typeof body === "object" && body !== null && "error" in body && typeof body.error === "string" && body.error) {
      detail = `${body.error} (${detail})`;
    }
  } catch {
    // Non-JSON error body: the status is all there is.
  }
  return { status: "failed", error: detail };
}

/** The server's `error` value from a failed render response body, if any. */
export function errorFieldOf(bodyText: string): string | undefined {
  try {
    const body: unknown = JSON.parse(bodyText);
    if (typeof body === "object" && body !== null && "error" in body && typeof body.error === "string") {
      return body.error;
    }
  } catch {
    // Not JSON.
  }
  return undefined;
}
