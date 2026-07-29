import assert from "node:assert/strict";
import {
  test
} from "node:test";
import {
  getAuthdTestSuite
} from "../suite/get-authd-test-suite.js";
import {
  assertNonDisclosingError
} from "../support/assert-browser-response.js";
import {
  beginAuthentication,
  browserPostHeaders
} from "../support/browser-flow.js";
import {
  readHeader,
  requestAuthd
} from "../support/request-authd.js";

test("enforces declared body, target, and header bounds on every route",
  async () => {
    const oversizedBody = "x".repeat(4 * 1024 + 1);
    for (const [method, path, headers] of [
      [
        "POST",
        "/auth/v1/begin",
        browserPostHeaders(oversizedBody)
      ],
      [
        "GET",
        "/auth/v1/callback",
        [
          ["Host", "auth.example.test"],
          ["Content-Length", String(Buffer.byteLength(oversizedBody))]
        ]
      ],
      [
        "POST",
        "/auth/v1/logout",
        browserPostHeaders(oversizedBody)
      ]
    ] as const) {
      const response = await requestAuthd({
        method,
        path,
        headers,
        body: oversizedBody
      });
      assertNonDisclosingError(response, 413);
    }

    for (const [method, path] of [
      ["POST", "/auth/v1/begin"],
      ["GET", "/auth/v1/callback"],
      ["POST", "/auth/v1/logout"]
    ] as const) {
      const target = await requestAuthd({
        method,
        path: `${path}?${"x".repeat(16 * 1024)}`,
        headers: [["Host", "auth.example.test"]]
      });
      assertNonDisclosingError(target, 414);
      const header = await requestAuthd({
        method,
        path,
        headers: [
          ["Host", "auth.example.test"],
          ["X-Bounded-Test", "x".repeat(16_400)]
        ]
      });
      assertNonDisclosingError(header, 431);
    }

    const cookie = await requestAuthd({
      method: "GET",
      path: "/auth/v1/callback?state=invalid&code=value",
      headers: [
        ["Host", "auth.example.test"],
        ["Cookie", `other=${"x".repeat(8 * 1024)}`]
      ]
    });
    assertNonDisclosingError(cookie, 431);
  });

test("applies each route token bucket with bounded Retry-After",
  async () => {
    const suite = getAuthdTestSuite();
    await suite.authd.restart();
    try {
      for (const testCase of [
        {
          count: 21,
          request: () => {
            const body = "tenant_id=unknown&provider_id=oidc";
            return requestAuthd({
              method: "POST",
              path: "/auth/v1/begin",
              headers: browserPostHeaders(body),
              body
            });
          }
        },
        {
          count: 41,
          request: () => requestAuthd({
            method: "GET",
            path: "/auth/v1/callback?state=invalid&code=value",
            headers: [["Host", "auth.example.test"]]
          })
        },
        {
          count: 21,
          request: () => requestAuthd({
            method: "POST",
            path: "/auth/v1/logout",
            headers: browserPostHeaders("")
          })
        }
      ]) {
        const responses = await Promise.all(
          Array.from(
            { length: testCase.count },
            async () => await testCase.request()));
        const limited = responses.find(
          (response) => response.statusCode === 429);
        assert.ok(limited);
        assertNonDisclosingError(limited, 429);
        assert.equal(readHeader(limited, "retry-after"), "1");
      }
    } finally {
      await suite.authd.restart();
    }
  });

test("admits at most 32 consumed callbacks without queueing",
  async () => {
    const suite = getAuthdTestSuite();
    await suite.provider.setMode("token_slow");
    try {
      const callbacks: Array<{
        readonly path: string;
        readonly cookie: string;
      }> = [];
      for (let index = 0; index < 33; index++) {
        const begun = await beginAuthentication(`/${String(index)}`);
        const authorization = await suite.provider.authorize(
          begun.authorizationLocation);
        const callback = new URL(authorization.location);
        callbacks.push({
          path: `${callback.pathname}${callback.search}`,
          cookie: begun.stateCookie
        });
      }
      const responses = await Promise.all(callbacks.map(
        async (callback) =>
          await requestAuthd({
            method: "GET",
            path: callback.path,
            headers: [
              ["Host", "auth.example.test"],
              ["Cookie", callback.cookie]
            ]
          })));
      assert.equal(
        responses.filter(
          (response) => response.statusCode === 429).length,
        1);
      assert.equal(
        responses.filter(
          (response) => response.statusCode === 303).length,
        32);
    } finally {
      await suite.provider.setMode("available");
    }
  });
