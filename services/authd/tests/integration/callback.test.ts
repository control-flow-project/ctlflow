import assert from "node:assert/strict";
import {
  test
} from "node:test";
import type {
  OidcProviderMode
} from "@ctlflow/authd/testing/provider";
import {
  getAuthdTestSuite
} from "../suite/get-authd-test-suite.js";
import {
  assertNonDisclosingError,
  assertSecurityHeaders
} from "../support/assert-browser-response.js";
import {
  beginAuthentication,
  completeAuthentication,
  sessionCookie
} from "../support/browser-flow.js";
import {
  readHeader,
  readHeaders,
  requestAuthd
} from "../support/request-authd.js";

test("completes OIDC through exactly two Egressd calls and creates a Session",
  async () => {
    const suite = getAuthdTestSuite();
    await suite.provider.setMode("available");
    await suite.provider.clearEvidence();
    await suite.egressd.setMode("available");
    await suite.egressd.clearEvidence();
    const completed = await completeAuthentication("/home?view=compact");

    assert.equal(completed.callback.statusCode, 303);
    assert.equal(readHeader(completed.callback, "location"),
      "/home?view=compact");
    assert.equal(completed.callback.body, "");
    assertSecurityHeaders(completed.callback);
    const cookies = readHeaders(completed.callback, "set-cookie");
    assert.equal(cookies.length, 2);
    const session = cookies.find((value) =>
      value.startsWith("__Host-ctlflow-session="));
    const state = cookies.find((value) =>
      value.startsWith("__Host-ctlflow-auth-state="));
    assert.match(
      session ?? "",
      /^__Host-ctlflow-session=[A-Za-z0-9_-]{43}; /u);
    assert.equal(session?.includes("Secure"), true);
    assert.equal(session?.includes("HttpOnly"), true);
    assert.equal(session?.includes("SameSite=Lax"), true);
    assert.equal(session?.includes("Domain="), false);
    const maximumAge = /Max-Age=([0-9]+);/u.exec(
      session ?? "")?.[1];
    const expiry = /Expires=([^;]+)$/u.exec(session ?? "")?.[1];
    assert.ok(maximumAge);
    assert.equal(Number(maximumAge) >= 1, true);
    assert.equal(Number(maximumAge) <= 30 * 24 * 60 * 60, true);
    assert.equal(Number.isNaN(Date.parse(expiry ?? "")), false);
    assert.equal(state?.includes("Max-Age=0"), true);
    assert.equal(state?.includes("Secure"), true);
    assert.equal(state?.includes("HttpOnly"), true);
    assert.equal(state?.includes("SameSite=Lax"), true);
    assert.equal(state?.includes("Domain="), false);
    assert.equal(
      state?.includes("Thu, 01 Jan 1970 00:00:00 GMT"),
      true);

    const egress = await suite.egressd.readEvidence();
    assert.deepEqual(
      egress.map((item) => [item.method, item.path]),
      [["POST", "/token"], ["GET", "/userinfo"]]);
    assert.match(egress[0]!.authorization, /^Basic /u);
    assert.match(egress[1]!.authorization, /^Bearer /u);
    assert.equal(egress[0]!.traceparent?.length, 55);
    const provider = await suite.provider.readEvidence();
    assert.equal(provider.tokens.length, 1);
    assert.equal(provider.userInfo.length, 1);
    assert.equal(provider.tokens[0]!.traceparent, undefined);
    assert.equal(provider.userInfo[0]!.traceparent, undefined);
  });

test("consumes a valid provider error without a dependency call",
  async () => {
    const suite = getAuthdTestSuite();
    await suite.provider.setMode("authorization_error");
    await suite.egressd.clearEvidence();
    const completed = await completeAuthentication();
    assertNonDisclosingError(completed.callback, 401);
    assert.equal((await suite.egressd.readEvidence()).length, 0);
    const state = readHeaders(completed.callback, "set-cookie");
    assert.equal(state.length, 1);
    assert.equal(state[0]!.includes("Max-Age=0"), true);
    assert.equal(
      state[0]!.includes("Thu, 01 Jan 1970 00:00:00 GMT"),
      true);
    assert.equal(state[0]!.includes("Domain="), false);
    await suite.provider.setMode("available");
  });

test("rejects every undeclared or ambiguous callback query shape",
  async () => {
    const values = [
      "",
      "?state=invalid&code=value",
      `?state=${"A".repeat(43)}`,
      `?state=${"A".repeat(43)}&code=`,
      `?state=${"A".repeat(43)}&code=value&error=denied`,
      `?state=${"A".repeat(43)}&error=denied&error_uri=https%3A%2F%2Fevil`,
      `?state=${"A".repeat(43)}&error_description=detail`,
      `?state=${"A".repeat(43)}&code=value&code=again`
    ];
    for (const query of values) {
      const response = await requestAuthd({
        method: "GET",
        path: `/auth/v1/callback${query}`,
        headers: [["Host", "auth.example.test"]]
      });
      assertNonDisclosingError(response, 400);
    }
  });

test("maps strict token, signature, claim, and UserInfo rejection to 401",
  async () => {
    const suite = getAuthdTestSuite();
    const modes: readonly OidcProviderMode[] = [
      "token_rejected",
      "token_bad_content_type",
      "token_invalid_json",
      "token_duplicate_member",
      "token_invalid_values",
      "invalid_signature",
      "invalid_id_token_header",
      "invalid_issuer",
      "invalid_audience",
      "missing_id_token_subject",
      "expired",
      "future_iat",
      "old_iat",
      "future_nbf",
      "bad_at_hash",
      "userinfo_rejected",
      "userinfo_bad_content_type",
      "userinfo_invalid_json",
      "userinfo_duplicate_member",
      "userinfo_invalid_subject",
      "subject_mismatch"
    ];
    for (const mode of modes) {
      await suite.provider.setMode(mode);
      await suite.egressd.clearEvidence();
      const completed = await completeAuthentication();
      assertNonDisclosingError(completed.callback, 401);
      assertClearsConsumedState(completed.callback);
      const calls = await suite.egressd.readEvidence();
      assert.equal(calls.length >= 1 && calls.length <= 2, true);
    }
    await suite.provider.setMode("available");
  });

test("accepts a sole audience array and ignores extra token members",
  async () => {
    const suite = getAuthdTestSuite();
    for (const mode of [
      "audience_array",
      "token_extra_members"
    ] as const) {
      await suite.provider.setMode(mode);
      await suite.egressd.clearEvidence();
      const completed = await completeAuthentication();
      assert.equal(completed.callback.statusCode, 303);
      assert.equal((await suite.egressd.readEvidence()).length, 2);
    }
    await suite.provider.setMode("available");
  });

test("maps provider, Egressd, and Identityd availability and rejection",
  async () => {
    const suite = getAuthdTestSuite();
    for (const mode of [
      "token_unavailable",
      "userinfo_unavailable",
      "token_delayed",
      "userinfo_delayed"
    ] as const) {
      await suite.provider.setMode(mode);
      const completed = await completeAuthentication();
      assertNonDisclosingError(completed.callback, 503);
      assertClearsConsumedState(completed.callback);
    }

    await suite.provider.setMode("available");
    await suite.egressd.setMode("unavailable");
    const unavailable = await completeAuthentication();
    assertNonDisclosingError(unavailable.callback, 503);
    assertClearsConsumedState(unavailable.callback);
    assert.equal((await suite.egressd.readEvidence()).length >= 1, true);
    await suite.egressd.setMode("available");

    await suite.identitySource.setMode("unavailable");
    try {
      const identityUnavailable = await completeAuthentication();
      assertNonDisclosingError(identityUnavailable.callback, 503);
      assertClearsConsumedState(identityUnavailable.callback);
    } finally {
      await suite.identitySource.setMode("available");
    }

    await suite.provider.setMode("unknown_subject");
    await suite.egressd.clearEvidence();
    const rejected = await completeAuthentication();
    assertNonDisclosingError(rejected.callback, 401);
    assertClearsConsumedState(rejected.callback);
    assert.equal((await suite.egressd.readEvidence()).length, 2);
    await suite.provider.setMode("available");
  });

test("propagates browser cancellation and consumes the in-flight attempt",
  async () => {
    const suite = getAuthdTestSuite();
    await suite.provider.setMode("available");
    await suite.egressd.setMode("delayed");
    await suite.egressd.clearEvidence();
    const begun = await beginAuthentication();
    const authorization = await suite.provider.authorize(
      begun.authorizationLocation);
    const callback = new URL(authorization.location);
    await assert.rejects(requestAuthd({
      method: "GET",
      path: `${callback.pathname}${callback.search}`,
      headers: [
        ["Host", "auth.example.test"],
        ["Cookie", begun.stateCookie]
      ],
      signal: AbortSignal.timeout(100)
    }));
    await suite.egressd.setMode("available");
    const replay = await requestAuthd({
      method: "GET",
      path: `${callback.pathname}${callback.search}`,
      headers: [
        ["Host", "auth.example.test"],
        ["Cookie", begun.stateCookie]
      ]
    });
    assertNonDisclosingError(replay, 400);
    assert.equal((await suite.egressd.readEvidence()).length, 1);
  });

test("replaces the browser cookie without revoking the previous Session",
  async () => {
    const suite = getAuthdTestSuite();
    await suite.provider.setMode("available");
    const first = await completeAuthentication();
    const firstCookie = sessionCookie(first.callback);
    assert.ok(firstCookie);
    const second = await completeAuthentication(undefined, firstCookie);
    assert.ok(sessionCookie(second.callback));
    assert.equal(readHeader(second.callback, "location"), "/");

    const logout = await requestAuthd({
      method: "POST",
      path: "/auth/v1/logout",
      headers: [
        ["Host", "auth.example.test"],
        ["Origin", "https://auth.example.test"],
        ["Cookie", firstCookie]
      ]
    });
    assert.equal(logout.statusCode, 303);
  });

function assertClearsConsumedState(
  response: Awaited<ReturnType<typeof requestAuthd>>
): void {
  const cookies = readHeaders(response, "set-cookie");
  assert.equal(cookies.length, 1);
  assert.equal(
    cookies[0]!.startsWith("__Host-ctlflow-auth-state=; "),
    true);
  assert.equal(cookies[0]!.includes("Max-Age=0"), true);
}
