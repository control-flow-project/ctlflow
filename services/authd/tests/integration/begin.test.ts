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
  beginAuthentication,
  browserPostHeaders
} from "../support/browser-flow.js";
import {
  readHeader,
  readHeaders,
  requestAuthd
} from "../support/request-authd.js";

test("builds the exact OIDC authorization request and bounded state cookie",
  async () => {
    const suite = getAuthdTestSuite();
    await suite.provider.setMode("available");
    await suite.provider.clearEvidence();
    await suite.egressd.clearEvidence();
    const begun = await beginAuthentication("/workspace?tab=active");

    assert.equal(begun.response.statusCode, 303);
    assert.equal(begun.response.body, "");
    assertSecurityHeaders(begun.response);
    const cookie = readHeaders(begun.response, "set-cookie");
    assert.equal(cookie.length, 1);
    assert.match(
      cookie[0]!,
      /^__Host-ctlflow-auth-state=[A-Za-z0-9_-]{43}; /u);
    for (const attribute of [
      "Path=/",
      "Secure",
      "HttpOnly",
      "SameSite=Lax",
      "Max-Age=600"
    ]) {
      assert.equal(cookie[0]!.includes(attribute), true);
    }
    assert.equal(cookie[0]!.includes("Domain="), false);

    const authorization = await suite.provider.authorize(
      begun.authorizationLocation);
    assert.equal(authorization.statusCode, 303);
    const evidence = await suite.provider.readEvidence();
    assert.equal(evidence.authorizations.length, 1);
    assert.deepEqual(
      evidence.authorizations[0]!.parameters.map(
        (parameter) => parameter.name),
      [
        "response_type",
        "client_id",
        "redirect_uri",
        "scope",
        "state",
        "code_challenge",
        "code_challenge_method"
      ]);
    assert.equal((await suite.egressd.readEvidence()).length, 0);
  });

test("selects exact tenant and provider and strictly validates forms",
  async () => {
    const cases = [
      "tenant_id=unknown&provider_id=oidc",
      "tenant_id=acme&provider_id=unknown",
      "tenant_id=acme&tenant_id=acme&provider_id=oidc",
      "tenant_id=acme&provider_id=oidc&unexpected=value",
      "tenant_id=ACME&provider_id=oidc",
      "tenant_id=acme&provider_id=oidc&return_to=https%3A%2F%2Fevil.test",
      "tenant_id=acme&provider_id=oidc&return_to=%2Fbad%23fragment",
      "tenant_id=acme&provider_id=oidc&return_to=%2Fbad%5Cpath"
    ];
    for (const body of cases) {
      const response = await requestAuthd({
        method: "POST",
        path: "/auth/v1/begin",
        headers: browserPostHeaders(body),
        body
      });
      assertNonDisclosingError(response, 400);
    }

    const unsupported = await requestAuthd({
      method: "POST",
      path: "/auth/v1/begin",
      headers: [
        ["Host", "auth.example.test"],
        ["Origin", "https://auth.example.test"],
        ["Content-Type", "application/json"],
        ["Content-Length", "2"]
      ],
      body: "{}"
    });
    assertNonDisclosingError(unsupported, 415);
  });

test("requires canonical Origin and authority on both browser POST routes",
  async () => {
    for (const [path, body] of [
      [
        "/auth/v1/begin",
        "tenant_id=acme&provider_id=oidc"
      ],
      ["/auth/v1/logout", ""]
    ] as const) {
      for (const headers of [
        [
          ["Host", "auth.example.test"]
        ],
        [
          ["Host", "auth.example.test"],
          ["Origin", "https://other.example.test"]
        ],
        [
          ["Host", "other.example.test"],
          ["Origin", "https://auth.example.test"]
        ],
        [
          ["Host", "auth.example.test"],
          ["Origin", "null"]
        ],
        [
          ["Host", "auth.example.test"],
          ["Origin", "https://auth.example.test"],
          ["Origin", "https://auth.example.test"]
        ],
        [
          ["Host", "other.example.test"],
          ["X-Forwarded-Host", "auth.example.test"],
          ["X-Forwarded-Proto", "https"]
        ]
      ] as const) {
        const response = await requestAuthd({
          method: "POST",
          path,
          headers: [
            ...headers,
            ["Content-Type", "application/x-www-form-urlencoded"],
            ["Content-Length", String(Buffer.byteLength(body))]
          ],
          body
        });
        assertNonDisclosingError(response, 403);
      }
    }
  });

test("enforces the finite Begin deadline",
  async () => {
    const body = "tenant_id=acme&provider_id=oidc";
    const response = await requestAuthd({
      method: "POST",
      path: "/auth/v1/begin",
      headers: browserPostHeaders(body),
      body,
      bodyDelayMilliseconds: 2_500
    });
    assertNonDisclosingError(response, 503);
  });

test("binds one-time state to the browser and loses it on restart",
  async () => {
    const suite = getAuthdTestSuite();
    await suite.provider.setMode("available");
    const first = await beginAuthentication("/first");
    const firstAuthorization = await suite.provider.authorize(
      first.authorizationLocation);
    const second = await beginAuthentication(
      "/second",
      first.stateCookie);
    const secondAuthorization = await suite.provider.authorize(
      second.authorizationLocation);

    const replacedUrl = new URL(firstAuthorization.location);
    const replaced = await requestAuthd({
      method: "GET",
      path: `${replacedUrl.pathname}${replacedUrl.search}`,
      headers: [
        ["Host", "auth.example.test"],
        ["Cookie", first.stateCookie]
      ]
    });
    assertNonDisclosingError(replaced, 400);

    const secondUrl = new URL(secondAuthorization.location);
    const mismatch = await requestAuthd({
      method: "GET",
      path: `${secondUrl.pathname}${secondUrl.search}`,
      headers: [
        ["Host", "auth.example.test"],
        [
          "Cookie",
          "__Host-ctlflow-auth-state="
          + "A".repeat(43)
        ]
      ]
    });
    assertNonDisclosingError(mismatch, 400);
    const duplicateCookie = await requestAuthd({
      method: "GET",
      path: `${secondUrl.pathname}${secondUrl.search}`,
      headers: [
        ["Host", "auth.example.test"],
        [
          "Cookie",
          `${second.stateCookie}; ${second.stateCookie}`
        ]
      ]
    });
    assertNonDisclosingError(duplicateCookie, 400);
    const accepted = await requestAuthd({
      method: "GET",
      path: `${secondUrl.pathname}${secondUrl.search}`,
      headers: [
        ["Host", "auth.example.test"],
        ["Cookie", second.stateCookie]
      ]
    });
    assert.equal(accepted.statusCode, 303);
    const replay = await requestAuthd({
      method: "GET",
      path: `${secondUrl.pathname}${secondUrl.search}`,
      headers: [
        ["Host", "auth.example.test"],
        ["Cookie", second.stateCookie]
      ]
    });
    assertNonDisclosingError(replay, 400);

    const beforeRestart = await beginAuthentication("/restart");
    const redirect = await suite.provider.authorize(
      beforeRestart.authorizationLocation);
    await suite.authd.restart();
    const restartUrl = new URL(redirect.location);
    const lost = await requestAuthd({
      method: "GET",
      path: `${restartUrl.pathname}${restartUrl.search}`,
      headers: [
        ["Host", "auth.example.test"],
        ["Cookie", beforeRestart.stateCookie]
      ]
    });
    assertNonDisclosingError(lost, 400);
    assert.equal(readHeader(lost, "set-cookie"), undefined);
  });
