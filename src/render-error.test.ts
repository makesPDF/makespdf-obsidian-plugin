/**
 * Tests for the failed-render notice: which part of the server's body is
 * shown, when the API-key hint appears, and that the feedback context only
 * ever receives the code.
 */
import { describe, it, expect } from "vitest";

import { API_KEY_HINT, describeRenderFailure, parseRenderErrorBody } from "./render-error";

// The exact body `buildAnonPageCapBody` returns (MAK-119).
const PAGE_CAP_MESSAGE =
  "This document rendered to 42 pages; anonymous renders are limited to 20. Sign up or pay per render for no page cap.";
const PAGE_CAP_BODY = JSON.stringify({
  error: "page-cap-exceeded",
  limit: 20,
  actual: 42,
  message: PAGE_CAP_MESSAGE,
  tip: "Anonymous renders are capped.",
  upgrade: { account: { url: "https://makespdf.com/signup" }, wallet: {} },
});

describe("parseRenderErrorBody", () => {
  it("reads the page-cap fields", () => {
    expect(parseRenderErrorBody(PAGE_CAP_BODY)).toEqual({
      error: "page-cap-exceeded",
      message: PAGE_CAP_MESSAGE,
      limit: 20,
      actual: 42,
    });
  });

  it("yields an empty body for non-JSON and for wrong field types", () => {
    expect(parseRenderErrorBody("<html>Bad gateway</html>")).toEqual({});
    expect(parseRenderErrorBody("null")).toEqual({});
    expect(
      parseRenderErrorBody('{"error":42,"message":{},"limit":"20","actual":null}'),
    ).toEqual({});
  });
});

describe("describeRenderFailure", () => {
  it("shows the server message and, without a key, the settings hint for the page cap", () => {
    const failure = describeRenderFailure({
      status: 400,
      bodyText: PAGE_CAP_BODY,
      hasApiKey: false,
    });

    expect(failure.message).toContain(PAGE_CAP_MESSAGE);
    expect(failure.message).toContain(API_KEY_HINT);
    // A sentence is already terminated; the hint is a second sentence, not "..".
    expect(failure.message).not.toContain("..");
    expect(failure.errorCode).toBe("page-cap-exceeded");
    expect(failure.offerSettingsLink).toBe(true);
  });

  it("does not show the hint or the settings link when a key is set", () => {
    const failure = describeRenderFailure({
      status: 400,
      bodyText: PAGE_CAP_BODY,
      hasApiKey: true,
    });

    expect(failure.message).toBe(PAGE_CAP_MESSAGE);
    expect(failure.message).not.toContain(API_KEY_HINT);
    expect(failure.errorCode).toBe("page-cap-exceeded");
    expect(failure.offerSettingsLink).toBe(false);
  });

  it("falls back to the error code when the body has no message", () => {
    const failure = describeRenderFailure({
      status: 400,
      bodyText: '{"error":"page-cap-exceeded","limit":20,"actual":42}',
      hasApiKey: false,
    });

    // The counts ride along, as they do in the VS Code plugin, so the fallback
    // is not a bare code when the server told us the figures.
    expect(failure.message).toBe(`page-cap-exceeded (42 pages, cap 20). ${API_KEY_HINT}`);
    expect(failure.errorCode).toBe("page-cap-exceeded");
    expect(failure.offerSettingsLink).toBe(true);
  });

  it("falls back to the bare code when the page counts are missing", () => {
    const failure = describeRenderFailure({
      status: 400,
      bodyText: '{"error":"page-cap-exceeded"}',
      hasApiKey: true,
    });

    expect(failure.message).toBe("page-cap-exceeded");
    expect(failure.offerSettingsLink).toBe(false);
  });

  it("falls back to HTTP <status> for a non-JSON body", () => {
    const failure = describeRenderFailure({
      status: 502,
      bodyText: "<html>Bad gateway</html>",
      hasApiKey: false,
    });

    expect(failure).toEqual({
      message: "HTTP 502",
      errorCode: undefined,
      offerSettingsLink: false,
    });
  });

  it("falls back to HTTP <status> when JSON carries neither message nor error", () => {
    expect(
      describeRenderFailure({ status: 500, bodyText: '{"ok":false}', hasApiKey: false }).message,
    ).toBe("HTTP 500");
  });

  it("keeps the API-key hint on the rate-limit and size limits without a key", () => {
    for (const status of [429, 413]) {
      const anon = describeRenderFailure({
        status,
        bodyText: '{"error":"rate-limited"}',
        hasApiKey: false,
      });
      expect(anon.message).toBe(`rate-limited. ${API_KEY_HINT}`);
      // The hint names the settings, so the notice must offer a way there.
      expect(anon.offerSettingsLink).toBe(true);

      const authed = describeRenderFailure({
        status,
        bodyText: '{"error":"rate-limited"}',
        hasApiKey: true,
      });
      expect(authed.message).toBe("rate-limited");
      expect(authed.offerSettingsLink).toBe(false);
    }
  });

  it("never puts the message sentence in errorCode", () => {
    const failure = describeRenderFailure({
      status: 500,
      bodyText: JSON.stringify({
        error: "Cannot read image at vault/secret.png",
        message: PAGE_CAP_MESSAGE,
      }),
      hasApiKey: false,
    });

    expect(failure.message).toContain(PAGE_CAP_MESSAGE);
    expect(failure.errorCode).toBeUndefined();
    expect(failure.errorCode).not.toBe(PAGE_CAP_MESSAGE);
  });

  it("prefers the server message over the error code", () => {
    const failure = describeRenderFailure({
      status: 500,
      bodyText: '{"error":"internal-error","message":"Rendering failed. Try again."}',
      hasApiKey: false,
    });

    expect(failure.message).toBe("Rendering failed. Try again.");
    expect(failure.errorCode).toBe("internal-error");
  });
});
