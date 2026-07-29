import assert from "node:assert/strict";
import {
  test
} from "node:test";
import {
  requestEgressd
} from "../support/request-egressd.js";
import {
  getEgressdTestSuite
} from "../suite/get-egressd-test-suite.js";

test("requires exactly one proxy bearer credential", async () => {
  const caller = getEgressdTestSuite().caller;
  const missing = await requestEgressd({ authenticate: false });
  assertProxyAuthenticationRequired(missing);

  const malformed = await requestEgressd({
    headers: [["Proxy-Authorization", "Basic invalid"]]
  });
  assertProxyAuthenticationRequired(malformed);

  const duplicate = await requestEgressd({
    headers: [
      ["Proxy-Authorization", "Bearer first"],
      ["Proxy-Authorization", "Bearer second"]
    ]
  });
  assertProxyAuthenticationRequired(duplicate);

  const caseInsensitiveScheme = await requestEgressd({
    headers: [[
      "Proxy-Authorization",
      `bearer ${caller.callerToken}`
    ]]
  });
  assert.equal(caseInsensitiveScheme.statusCode, 200);
});

test("rejects invalid signed workload credentials", async () => {
  const token = getEgressdTestSuite().caller.callerToken;
  const segments = token.split(".");
  assert.equal(segments.length, 3);
  const signature = segments[2]!;
  const corruptedSignature =
    `${signature.startsWith("a") ? "b" : "a"}${signature.slice(1)}`;
  const corrupted =
    `${segments[0]}.${segments[1]}.${corruptedSignature}`;
  const response = await withToken(corrupted);
  assertProxyAuthenticationRequired(response);
});

test("rejects expired and overlong workload credentials", async () => {
  const caller = getEgressdTestSuite().caller;
  assertProxyAuthenticationRequired(await withToken(caller.expiredToken));
  assertProxyAuthenticationRequired(await withToken(caller.overlongToken));
});

test("rejects the wrong audience and an unbound workload", async () => {
  const caller = getEgressdTestSuite().caller;
  assertProxyAuthenticationRequired(
    await withToken(caller.wrongAudienceToken));
  assertProxyAuthenticationRequired(
    await withToken(caller.wrongIssuerToken));
  assertProxyAuthenticationRequired(await withToken(caller.unboundToken));
});

test("admits only the configured namespace and service account",
  async () => {
    const caller = getEgressdTestSuite().caller;
    assertProxyAuthenticationRequired(
      await withToken(caller.unadmittedToken));
    assertProxyAuthenticationRequired(
      await withToken(caller.wrongNamespaceToken));
    assert.equal((await withToken(caller.callerToken)).statusCode, 200);
  });

async function withToken(token: string) {
  return await requestEgressd({
    headers: [["Proxy-Authorization", `Bearer ${token}`]]
  });
}

function assertProxyAuthenticationRequired(
  response: Awaited<ReturnType<typeof requestEgressd>>
): void {
  assert.equal(response.statusCode, 407);
  assert.equal(response.headers.get("proxy-authenticate")?.[0], "Bearer");
  assert.equal(response.body.toString(), "Proxy authentication required\n");
}
