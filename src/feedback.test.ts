/**
 * Tests for the feedback payload rules: fingerprint-only context, no note
 * content, and the result classification the UI relies on.
 */
import { describe, it, expect } from "vitest";

import {
  asErrorCode,
  buildFeedbackRequest,
  buildProblemContext,
  errorFieldOf,
  sendFeedback,
  validateFeedbackMessage,
  type FeedbackRequest,
  type FeedbackResponse,
} from "./feedback";

const FACTS = { httpStatus: 400, errorCode: "page-cap-exceeded", pageSize: "A4", inputBytes: 1234 };

const ARGS = {
  apiUrl: "https://makespdf.com",
  version: "1.1.0",
  apiKey: "",
  kind: "idea" as const,
  message: "hello there",
};

function respond(status: number, text = "{}"): () => Promise<FeedbackResponse> {
  return () => Promise.resolve({ status, text });
}

describe("buildProblemContext", () => {
  it("carries exactly the fingerprint fields", () => {
    expect(buildProblemContext(FACTS)).toEqual(FACTS);
  });

  it("drops fields the server schema would reject", () => {
    expect(
      buildProblemContext({
        httpStatus: undefined,
        errorCode: "Rate limit exceeded",
        pageSize: "A4",
        inputBytes: 60_000_000,
      }),
    ).toEqual({ pageSize: "A4" });
  });
});

describe("asErrorCode", () => {
  it("forwards only code-shaped strings", () => {
    expect(asErrorCode("page-cap-exceeded")).toBe("page-cap-exceeded");
    expect(asErrorCode("rate-limited")).toBe("rate-limited");
    expect(asErrorCode("Cannot read image at vault/secret.png")).toBeUndefined();
    expect(asErrorCode("x".repeat(65))).toBeUndefined();
    expect(asErrorCode(undefined)).toBeUndefined();
  });
});

describe("buildFeedbackRequest", () => {
  it("sends kind, message and context only: no note text, path or vault name", () => {
    const note = "# Board minutes\n\nConfidential figures";
    const notePath = "Work/Board minutes.md";
    const vaultName = "Private Vault";
    const request = buildFeedbackRequest({
      ...ARGS,
      apiUrl: "https://makespdf.com/",
      kind: "problem",
      message: "  Export failed on a table.  ",
      context: buildProblemContext({ ...FACTS, inputBytes: new TextEncoder().encode(note).length }),
    });

    expect(request.url).toBe("https://makespdf.com/api/v1/feedback");
    expect(request.method).toBe("POST");
    expect(request.throw).toBe(false);
    const body = JSON.parse(request.body) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["context", "kind", "message"]);
    expect(body.message).toBe("Export failed on a table.");
    expect(Object.keys(body.context as object).sort()).toEqual([
      "errorCode",
      "httpStatus",
      "inputBytes",
      "pageSize",
    ]);
    for (const secret of ["Board minutes", "Confidential", notePath, vaultName]) {
      expect(request.body).not.toContain(secret);
    }
  });

  it("sets the client header always and Authorization only with a key", () => {
    const anon = buildFeedbackRequest(ARGS);
    expect(anon.headers["X-MakesPDF-Client"]).toBe("obsidian/1.1.0");
    expect(anon.headers.Authorization).toBeUndefined();
    expect(JSON.parse(anon.body)).not.toHaveProperty("context");

    const authed = buildFeedbackRequest({ ...ARGS, apiKey: "key_123" });
    expect(authed.headers.Authorization).toBe("Bearer key_123");
  });
});

describe("validateFeedbackMessage", () => {
  it("mirrors the server's 1..4000 trimmed range", () => {
    expect(validateFeedbackMessage("   ")).toBe("Please enter a message.");
    expect(validateFeedbackMessage("ok")).toBeNull();
    expect(validateFeedbackMessage("x".repeat(4000))).toBeNull();
    expect(validateFeedbackMessage("x".repeat(4001))).toMatch(/under 4000/);
  });
});

describe("sendFeedback", () => {
  it("classifies success, 429 and other failures", async () => {
    expect(await sendFeedback(ARGS, respond(200, '{"feedbackId":"f1"}'))).toEqual({ status: "sent" });
    expect(await sendFeedback(ARGS, respond(429))).toEqual({ status: "rate-limited" });
    expect(await sendFeedback(ARGS, respond(400, '{"error":"Invalid request"}'))).toEqual({
      status: "failed",
      error: "Invalid request (HTTP 400)",
    });
    expect(await sendFeedback(ARGS, respond(502, "<html>"))).toEqual({
      status: "failed",
      error: "HTTP 502",
    });
    expect(await sendFeedback(ARGS, () => Promise.reject(new Error("net::ERR_CONNECTION_REFUSED")))).toEqual({
      status: "failed",
      error: "net::ERR_CONNECTION_REFUSED",
    });
  });

  it("retries a rejected key once anonymously", async () => {
    const seen: (string | undefined)[] = [];
    const transport = (request: FeedbackRequest) => {
      seen.push(request.headers.Authorization);
      return Promise.resolve({ status: request.headers.Authorization ? 401 : 200, text: "{}" });
    };
    expect(await sendFeedback({ ...ARGS, apiKey: "stale" }, transport)).toEqual({ status: "sent" });
    expect(seen).toEqual(["Bearer stale", undefined]);

    // No key configured: nothing to drop, so a 401 is reported, not retried.
    expect(await sendFeedback(ARGS, respond(401, '{"error":"Unauthorized"}'))).toEqual({
      status: "failed",
      error: "Unauthorized (HTTP 401)",
    });
  });
});

describe("errorFieldOf", () => {
  it("reads the error field of a JSON body", () => {
    expect(errorFieldOf('{"error":"page-cap-exceeded","limit":20}')).toBe("page-cap-exceeded");
    expect(errorFieldOf("<html>")).toBeUndefined();
    expect(errorFieldOf('{"message":"x"}')).toBeUndefined();
  });
});
