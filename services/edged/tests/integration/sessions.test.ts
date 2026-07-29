import assert from "node:assert/strict";
import {
  test
} from "node:test";
import {
  assertBoundaryError
} from "../support/assert-boundary-error.js";
import {
  createUnknownSession,
  revokeSession
} from "../support/create-session.js";
import {
  requestEdged
} from "../support/request-edged.js";
import {
  sessionCookie
} from "../support/session-cookie.js";
import {
  waitForIdentityRecovery
} from "../support/wait-for-identity-recovery.js";
import {
  getEdgedTestSuite
} from "../suite/get-edged-test-suite.js";

test("rejects missing, duplicate, and malformed session cookies",
  async () => {
    const credential = await getEdgedTestSuite().session();
    for (const cookie of [
      undefined,
      "__Host-ctlflow-session=short",
      "__Host-ctlflow-session=invalid+character",
      `${sessionCookie(credential)}; ${sessionCookie(credential)}`
    ]) {
      const response = await requestEdged({
        ...(cookie === undefined
          ? {}
          : { headers: [["Cookie", cookie]] as const })
      });
      assertBoundaryError(response, 401, "Unauthorized");
    }
  });

test("rejects unknown, revoked, and expired sessions",
  async () => {
    const suite = getEdgedTestSuite();
    const revoked = await suite.session();
    await revokeSession(
      suite.identityClient,
      suite.authdWorkload,
      revoked);
    const expired = await suite.session();
    await suite.identitySource.expireSession(
      Buffer.from(expired, "base64url"));

    for (const credential of [
      createUnknownSession(),
      revoked,
      expired
    ]) {
      const response = await requestEdged({
        headers: [["Cookie", sessionCookie(credential)]]
      });
      assertBoundaryError(response, 401, "Unauthorized");
    }
  });

test("requires the session account to be eligible for the exact target",
  async () => {
    const credential = await getEdgedTestSuite()
      .session("bob@example.com");
    const response = await requestEdged({
      headers: [["Cookie", sessionCookie(credential)]]
    });
    assertBoundaryError(response, 401, "Unauthorized");
  });

test("exchanges the session on every request without a credential cache",
  async () => {
    const suite = getEdgedTestSuite();
    const credential = await suite.session();
    const first = await requestEdged({
      headers: [["Cookie", sessionCookie(credential)]]
    });
    assert.equal(first.statusCode, 200);

    await revokeSession(
      suite.identityClient,
      suite.authdWorkload,
      credential);
    const second = await requestEdged({
      headers: [["Cookie", sessionCookie(credential)]]
    });
    assertBoundaryError(second, 401, "Unauthorized");
  });

test("fails closed when Identityd is unavailable",
  async () => {
    const suite = getEdgedTestSuite();
    const credential = await suite.session();
    await suite.identitySource.setMode("unavailable");
    try {
      const response = await requestEdged({
        headers: [["Cookie", sessionCookie(credential)]]
      });
      assertBoundaryError(
        response,
        503,
        "Service unavailable");
    } finally {
      await suite.identitySource.setMode("available");
      await waitForIdentityRecovery(credential);
    }
  });
