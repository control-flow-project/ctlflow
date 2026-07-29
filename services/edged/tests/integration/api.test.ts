import assert from "node:assert/strict";
import {
  test
} from "node:test";
import {
  assertBoundaryError
} from "../support/assert-boundary-error.js";
import {
  parseApplicationEvidence
} from "../support/application-evidence.js";
import {
  readHeader,
  requestEdged
} from "../support/request-edged.js";
import {
  sessionCookie
} from "../support/session-cookie.js";
import {
  getEdgedTestSuite
} from "../suite/get-edged-test-suite.js";

const methods = [
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS"
] as const;

test("proxies every declared method at root and nested paths",
  async () => {
    const suite = getEdgedTestSuite();
    const credential = await suite.session();
    for (const method of methods) {
      for (const path of ["/", "/nested/item?order=raw%2Fvalue"]) {
        const body = method === "GET" || method === "HEAD"
          ? undefined
          : `${method}-body`;
        const response = await requestEdged({
          method,
          path,
          headers: [
            ["Cookie", sessionCookie(credential)],
            ["Content-Type", "application/octet-stream"]
          ],
          ...(body === undefined ? {} : { body })
        });
        const podLogs = response.statusCode === 200
          ? ""
          : (await suite.kubernetes.runKubectl([
              "logs",
              "deployment/edged",
              "--namespace",
              suite.kubernetes.namespace,
              "--all-containers=true",
              "--prefix=true",
              "--tail=100"
            ])).stdout;
        assert.equal(
          response.statusCode,
          200,
          [
            `${method} ${path}: ${response.body.toString("utf8")}`,
            JSON.stringify([...response.headers]),
            podLogs,
            suite.edged.diagnostics()
          ].join("\n"));
        if (method === "HEAD") {
          assert.equal(response.body.length, 0);
          continue;
        }
        const evidence = parseApplicationEvidence(response.body);
        assert.equal(evidence.method, method);
        assert.equal(evidence.target, path);
        assert.equal(
          evidence.bodyBytes,
          body === undefined ? 0 : Buffer.byteLength(body));
        assert.match(
          String(evidence.headers.authorization),
          /^Bearer [^.]+\.[^.]+\.[^.]+$/u);
      }
    }
  });

test("rejects every undeclared method with the fixed Allow set",
  async () => {
    for (const method of ["CONNECT", "TRACE", "CUSTOM"]) {
      const response = await requestEdged(
        method === "CONNECT"
          ? {
              method,
              path: "application.test:443",
              headers: [
                ["Host", "application.test:443"],
                ["Connection", "close"]
              ]
            }
          : {
              method,
              headers: [["Connection", "close"]]
            });
      assertBoundaryError(
        response,
        405,
        "Method not allowed");
      assert.equal(
        readHeader(response, "allow"),
        "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS");
    }
  });

test("isolates health and readiness on the probe listener",
  async () => {
    for (const path of ["/healthz", "/readyz"]) {
      const probe = await requestEdged({
        method: "GET",
        path,
        probe: true
      });
      assert.equal(probe.statusCode, 204);
      assert.equal(probe.body.length, 0);

      const publicResponse = await requestEdged({
        method: "GET",
        path
      });
      assertBoundaryError(publicResponse, 401, "Unauthorized");
    }

    const applicationOnProbe = await requestEdged({
      method: "POST",
      path: "/",
      probe: true
    });
    assert.equal(applicationOnProbe.statusCode, 404);
  });
