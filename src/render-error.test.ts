/**
 * Tests for the failed-render notice: which part of the server's body is
 * shown, when the API-key hint appears, and that the feedback context only
 * ever receives the code.
 */
import { describe, it, expect } from "vitest";

import { API_KEY_HINT, INVALID_API_KEY_TEXT, describeRenderFailure, parseRenderErrorBody } from "./render-error";

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

// The server answers a rejected bearer with 401 and code `invalid-api-key`
// (MAK-322); the plugin names that as the key rather than echoing the body.
describe("describeRenderFailure on a 401", () => {
  it("names an invalid key from the server's code, with the settings link", () => {
    const failure = describeRenderFailure({
      status: 401,
      bodyText: '{"error":"invalid-api-key","message":"Invalid API key"}',
      hasApiKey: true,
    });

    expect(failure).toEqual({
      message: INVALID_API_KEY_TEXT,
      errorCode: "invalid-api-key",
      offerSettingsLink: true,
    });
  });

  it("names an invalid key for any 401 on a request that carried one", () => {
    for (const bodyText of ['{"error":"unauthorized"}', "<html>Bad gateway</html>", ""]) {
      const failure = describeRenderFailure({ status: 401, bodyText, hasApiKey: true });
      expect(failure.message).toBe(INVALID_API_KEY_TEXT);
      expect(failure.offerSettingsLink).toBe(true);
    }
  });

  it("does not substitute the server's own wording for the key's", () => {
    const failure = describeRenderFailure({
      status: 401,
      bodyText: '{"error":"unauthorized","message":"Payment required"}',
      hasApiKey: true,
    });

    expect(failure.message).toBe(INVALID_API_KEY_TEXT);
    expect(failure.message).not.toContain("Payment required");
    // The sentence is the notice's whole text: no hint, no "..".
    expect(failure.message).not.toContain(API_KEY_HINT);
  });

  it("keeps today's text for a keyless 401", () => {
    const failure = describeRenderFailure({
      status: 401,
      bodyText: '{"error":"unauthorized"}',
      hasApiKey: false,
    });

    expect(failure).toEqual({
      message: "unauthorized",
      errorCode: "unauthorized",
      offerSettingsLink: false,
    });
    expect(
      describeRenderFailure({ status: 401, bodyText: "<html>", hasApiKey: false }).message,
    ).toBe("HTTP 401");
  });

  it("still names the key when the body carries its code but no request did", () => {
    // Defensive: the code is the server saying the key is wrong, so the
    // settings link is the fix even if the plugin thinks no key is set.
    const failure = describeRenderFailure({
      status: 401,
      bodyText: '{"error":"invalid-api-key"}',
      hasApiKey: false,
    });

    expect(failure.message).toBe(INVALID_API_KEY_TEXT);
    expect(failure.offerSettingsLink).toBe(true);
  });
});
