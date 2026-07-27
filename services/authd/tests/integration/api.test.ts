import assert from "node:assert/strict";
import {
  test
} from "node:test";
import {
  assertNonDisclosingError,
  assertSecurityHeaders
} from "../support/assert-browser-response.js";
import {
  readHeader,
  requestAuthd
} from "../support/request-authd.js";

test("serves exactly the three declared routes and isolates probes",
  async () => {
    const unknown = await requestAuthd({
      method: "GET",
      path: "/auth/v1/unknown",
      headers: [["Host", "auth.example.test"]]
    });
    assert.equal(unknown.statusCode, 404);

    for (const [path, declared, wrong] of [
      ["/auth/v1/begin", "POST", "GET"],
      ["/auth/v1/callback", "GET", "HEAD"],
      ["/auth/v1/logout", "POST", "OPTIONS"]
    ] as const) {
      const response = await requestAuthd({
        method: wrong,
        path,
        headers: [["Host", "auth.example.test"]]
      });
      if (wrong === "HEAD") {
        assert.equal(response.statusCode, 405);
        assert.equal(response.body, "");
        assertSecurityHeaders(response);
      } else {
        assertNonDisclosingError(response, 405);
      }
      assert.equal(readHeader(response, "allow"), declared);
    }

    for (const path of ["/healthz", "/readyz"]) {
      const probe = await requestAuthd({
        method: "GET",
        path,
        probe: true
      });
      assert.equal(probe.statusCode, 204);
      assert.equal(probe.body, "");
      const publicResponse = await requestAuthd({
        method: "GET",
        path,
        headers: [["Host", "auth.example.test"]]
      });
      assert.equal(publicResponse.statusCode, 404);
    }
    const browserOnProbe = await requestAuthd({
      method: "POST",
      path: "/auth/v1/begin",
      probe: true
    });
    assert.equal(browserOnProbe.statusCode, 404);
  });

test("returns fixed non-disclosing browser errors with security headers",
  async () => {
    const response = await requestAuthd({
      method: "GET",
      path: "/auth/v1/callback?state=invalid",
      headers: [["Host", "auth.example.test"]]
    });
    assertNonDisclosingError(response, 400);
    for (const forbidden of [
      "invalid",
      "state",
      "provider",
      "auth.example.test"
    ]) {
      assert.equal(response.body.includes(forbidden), false);
    }
  });
