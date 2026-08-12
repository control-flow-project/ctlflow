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

    const provider = await suite.provider.readEvidence();
    assert.equal(provider.tokens.length, 1);
    assert.equal(provider.userInfo.length, 1);
    assert.match(provider.tokens[0]!.authorization, /^Basic /u);
    assert.match(provider.userInfo[0]!.authorization, /^Bearer /u);
    assert.equal(provider.tokens[0]!.traceparent, undefined);
    assert.equal(provider.userInfo[0]!.traceparent, undefined);
  });

test("consumes a valid provider error without a dependency call",
  async () => {
    const suite = getAuthdTestSuite();
    await suite.provider.setMode("authorization_error");
    await suite.provider.clearEvidence();
    const completed = await completeAuthentication();
    assertNonDisclosingError(completed.callback, 401);
    const evidence = await suite.provider.readEvidence();
    assert.equal(evidence.tokens.length, 0);
    assert.equal(evidence.userInfo.length, 0);
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
      await suite.provider.clearEvidence();
      const completed = await completeAuthentication();
      assertNonDisclosingError(completed.callback, 401);
      assertClearsConsumedState(completed.callback);
      const evidence = await suite.provider.readEvidence();
      const calls =
        evidence.tokens.length + evidence.userInfo.length;
      assert.equal(calls >= 1 && calls <= 2, true);
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
      await suite.provider.clearEvidence();
      const completed = await completeAuthentication();
      assert.equal(completed.callback.statusCode, 303);
      const evidence = await suite.provider.readEvidence();
      assert.equal(evidence.tokens.length, 1);
      assert.equal(evidence.userInfo.length, 1);
    }
    await suite.provider.setMode("available");
  });

test("maps provider, Egressd, and Identityd availability and rejection",
  async () => {
    const suite = getAuthdTestSuite();
    for (const mode of [
      "token_unavailable",
      "userinfo_unavailable",
      "token_oversized",
      "userinfo_oversized",
      "token_delayed",
      "userinfo_delayed"
    ] as const) {
      await suite.provider.setMode(mode);
      const completed = await completeAuthentication();
      assertNonDisclosingError(completed.callback, 503);
      assertClearsConsumedState(completed.callback);
    }

    await suite.provider.setMode("available");
    await suite.provider.clearEvidence();
    await suite.egressd.suspend();
    try {
      const unavailable = await completeAuthentication();
      assertNonDisclosingError(unavailable.callback, 503);
      assertClearsConsumedState(unavailable.callback);
      const evidence = await suite.provider.readEvidence();
      assert.equal(evidence.tokens.length, 0);
      assert.equal(evidence.userInfo.length, 0);
    } finally {
      await suite.egressd.resume();
    }

    const active = await completeAfterEgressRecovery();
    const activeSession = sessionCookie(active.callback);
    assert.ok(activeSession);
    const pending = await beginAuthentication();
    const pendingAuthorization = await suite.provider.authorize(
      pending.authorizationLocation);
    const pendingCallback = new URL(pendingAuthorization.location);
    await suite.identitySource.setMode("unavailable");
    try {
      const identityUnavailable = await requestAuthd({
        method: "GET",
        path: `${pendingCallback.pathname}${pendingCallback.search}`,
        headers: [
          ["Host", "auth.example.test"],
          ["Cookie", pending.stateCookie]
        ]
      });
      assertNonDisclosingError(identityUnavailable, 503);
      assertClearsConsumedState(identityUnavailable);
      const logoutUnavailable = await requestAuthd({
        method: "POST",
        path: "/auth/v1/logout",
        headers: [
          ["Host", "auth.example.test"],
          ["Origin", "https://auth.example.test"],
          ["Cookie", activeSession]
        ]
      });
      assertNonDisclosingError(logoutUnavailable, 503);
      assert.equal(
        readHeaders(logoutUnavailable, "set-cookie").length,
        0);
    } finally {
      await suite.identitySource.setMode("available");
      await suite.authd.restart();
    }

    await suite.provider.setMode("unknown_subject");
    await suite.provider.clearEvidence();
    const rejected = await completeAuthentication();
    assertNonDisclosingError(rejected.callback, 401);
    assertClearsConsumedState(rejected.callback);
    const rejectedEvidence = await suite.provider.readEvidence();
    assert.equal(rejectedEvidence.tokens.length, 1);
    assert.equal(rejectedEvidence.userInfo.length, 1);
    await suite.provider.setMode("available");
  });

test("propagates browser cancellation and consumes the in-flight attempt",
  async () => {
    const suite = getAuthdTestSuite();
    await suite.provider.setMode("token_slow");
    try {
      await suite.provider.clearEvidence();
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
      const replay = await requestAuthd({
        method: "GET",
        path: `${callback.pathname}${callback.search}`,
        headers: [
          ["Host", "auth.example.test"],
          ["Cookie", begun.stateCookie]
        ]
      });
      assertNonDisclosingError(replay, 400);
      const evidence = await suite.provider.readEvidence();
      assert.equal(evidence.tokens.length, 1);
      assert.equal(evidence.userInfo.length, 0);
    } finally {
      await suite.provider.setMode("available");
    }
  });

test("maps Egressd workload authentication rejection to unavailable",
  async () => {
    const suite = getAuthdTestSuite();
    await suite.provider.setMode("available");
    await suite.provider.clearEvidence();
    const begun = await beginAuthentication();
    const authorization = await suite.provider.authorize(
      begun.authorizationLocation);
    const callback = new URL(authorization.location);
    await suite.egressd.setWorkloadAdmission("rejected");
    try {
      const rejected = await requestAuthd({
        method: "GET",
        path: `${callback.pathname}${callback.search}`,
        headers: [
          ["Host", "auth.example.test"],
          ["Cookie", begun.stateCookie]
        ]
      });
      assertNonDisclosingError(rejected, 503);
      assertClearsConsumedState(rejected);
      const evidence = await suite.provider.readEvidence();
      assert.equal(evidence.tokens.length, 0);
      assert.equal(evidence.userInfo.length, 0);
    } finally {
      await suite.egressd.setWorkloadAdmission("admitted");
      const recovered = await completeAfterEgressRecovery();
      assert.ok(sessionCookie(recovered.callback));
    }
  });

test("replaces the browser cookie without revoking the previous Session",
  async () => {
    const suite = getAuthdTestSuite();
    await suite.provider.setMode("available");
    const first = await completeAuthentication();
    assert.equal(
      first.callback.statusCode,
      303,
      [suite.authd.diagnostics(), suite.egressd.diagnostics()]
        .join("\n"));
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

async function completeAfterEgressRecovery(): Promise<
  Awaited<ReturnType<typeof completeAuthentication>>
> {
  const suite = getAuthdTestSuite();
  let completed:
    Awaited<ReturnType<typeof completeAuthentication>> | undefined;
  for (let attempt = 0; attempt < 8; attempt++) {
    completed = await completeAuthentication();
    if (completed.callback.statusCode === 303) {
      return completed;
    }
    assertNonDisclosingError(completed.callback, 503);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(
    completed?.callback.statusCode,
    303,
    [
      suite.authd.diagnostics(),
      suite.egressd.diagnostics()
    ].join("\n"));
  throw new Error("unreachable");
}
