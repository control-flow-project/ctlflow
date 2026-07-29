import assert from "node:assert/strict";
import {
  test
} from "node:test";
import {
  getEdgedTestSuite
} from "../suite/get-edged-test-suite.js";
import {
  runEdgedUntilFailure
} from "../support/run-edged-until-failure.js";
import {
  requestEdged
} from "../support/request-edged.js";

test("rejects every malformed or incompatible binding at startup",
  async () => {
    const executable =
      getEdgedTestSuite().edged.executablePath;
    for (const binding of [
      "{",
      JSON.stringify({
        schema_version: 2,
        target: { tenant_id: "acme" },
        upstream_port: 18_080
      }),
      JSON.stringify({
        schema_version: 1,
        target: { tenant_id: "Acme" },
        upstream_port: 18_080
      }),
      JSON.stringify({
        schema_version: 1,
        target: { tenant_id: "acme" },
        upstream_port: 0
      }),
      JSON.stringify({
        schema_version: 1,
        target: { tenant_id: "acme" },
        upstream_port: 18_080,
        unknown: true
      }),
      JSON.stringify({
        schema_version: 1,
        target: { tenant_id: "acme" },
        upstream_port: 18_080,
        padding: "x".repeat(64 * 1024)
      })
    ]) {
      const diagnostics = await runEdgedUntilFailure(
        executable,
        {
          CTLFLOW_PUBLIC_URL: "http://127.0.0.1:18081",
          CTLFLOW_PROBE_URL: "http://127.0.0.1:18082",
          CTLFLOW_EDGED_BINDING: binding
        });
      assert.match(
        diagnostics,
        /CTLFLOW_EDGED_BINDING|identifier|application port/iu);
    }
  });

test("keeps the admitted binding ready after rejection checks",
  async () => {
    const response = await requestEdged({
      method: "GET",
      path: "/readyz",
      probe: true
    });
    assert.equal(response.statusCode, 204);
  });
