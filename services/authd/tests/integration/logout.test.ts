import assert from "node:assert/strict";
import {
  test
} from "node:test";
import {
  getAuthdTestSuite
} from "../suite/get-authd-test-suite.js";
import {
  assertNonDisclosingError,
  assertSecurityHeaders
} from "../support/assert-browser-response.js";
import {
  browserPostHeaders,
  completeAuthentication,
  sessionCookie
} from "../support/browser-flow.js";
import {
  readHeader,
  readHeaders,
  requestAuthd
} from "../support/request-authd.js";

test("revokes a usable Session and clears both cookies on success",
  async () => {
    const suite = getAuthdTestSuite();
    await suite.provider.setMode("available");
    const authentication = await completeAuthentication();
    const session = sessionCookie(authentication.callback);
    assert.ok(session);
    const body = "return_to=%2Fsigned-out%3Ffrom%3Dlogout";
    const response = await requestAuthd({
      method: "POST",
      path: "/auth/v1/logout",
      headers: browserPostHeaders(body, session),
      body
    });
    assert.equal(response.statusCode, 303);
    assert.equal(
      readHeader(response, "location"),
      "/signed-out?from=logout");
    assertSecurityHeaders(response);
    const cookies = readHeaders(response, "set-cookie");
    assert.equal(cookies.length, 2);
    assert.equal(
      cookies.every((cookie) =>
        cookie.includes("Max-Age=0")
        && cookie.includes("Secure")
        && cookie.includes("HttpOnly")
        && cookie.includes("SameSite=Lax")
        && cookie.includes("Thu, 01 Jan 1970 00:00:00 GMT")
        && !cookie.includes("Domain=")),
      true);

    const alreadyRevoked = await requestAuthd({
      method: "POST",
      path: "/auth/v1/logout",
      headers: browserPostHeaders("", session)
    });
    assert.equal(alreadyRevoked.statusCode, 303);
  });

test("missing, duplicate, malformed, and unknown credentials are logged out",
  async () => {
    const values: Array<string | undefined> = [
      undefined,
      "__Host-ctlflow-session=invalid",
      "__Host-ctlflow-session="
        + Buffer.alloc(32, 7).toString("base64url"),
      "__Host-ctlflow-session="
        + Buffer.alloc(32, 8).toString("base64url")
        + "; __Host-ctlflow-session="
        + Buffer.alloc(32, 9).toString("base64url")
    ];
    for (const cookie of values) {
      const response = await requestAuthd({
        method: "POST",
        path: "/auth/v1/logout",
        headers: browserPostHeaders("", cookie)
      });
      assert.equal(response.statusCode, 303);
      assert.equal(readHeaders(response, "set-cookie").length, 2);
    }
  });

test("retains the Session cookie when Identityd is unavailable",
  async () => {
    const suite = getAuthdTestSuite();
    await suite.provider.setMode("available");
    const authentication = await completeAuthentication();
    const session = sessionCookie(authentication.callback);
    assert.ok(session);
    try {
      await suite.identitySource.setMode("unavailable");
      const response = await requestAuthd({
        method: "POST",
        path: "/auth/v1/logout",
        headers: browserPostHeaders("", session)
      });
      assertNonDisclosingError(response, 503);
      assert.equal(readHeaders(response, "set-cookie").length, 0);
    } finally {
      await suite.identitySource.setMode("available");
    }
  });

test("validates logout media, form, state cookie, and return target",
  async () => {
    for (const [body, status] of [
      ["unexpected=value", 400],
      ["return_to=https%3A%2F%2Fevil.test", 400]
    ] as const) {
      const response = await requestAuthd({
        method: "POST",
        path: "/auth/v1/logout",
        headers: browserPostHeaders(body),
        body
      });
      assertNonDisclosingError(response, status);
    }
    const malformedState = await requestAuthd({
      method: "POST",
      path: "/auth/v1/logout",
      headers: browserPostHeaders(
        "",
        "__Host-ctlflow-auth-state=invalid")
    });
    assertNonDisclosingError(malformedState, 400);
    const media = await requestAuthd({
      method: "POST",
      path: "/auth/v1/logout",
      headers: [
        ["Host", "auth.example.test"],
        ["Origin", "https://auth.example.test"],
        ["Content-Type", "application/json"],
        ["Content-Length", "2"]
      ],
      body: "{}"
    });
    assertNonDisclosingError(media, 415);
  });
