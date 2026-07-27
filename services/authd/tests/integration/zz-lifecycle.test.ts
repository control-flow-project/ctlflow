import assert from "node:assert/strict";
import {
  readFile,
  writeFile
} from "node:fs/promises";
import {
  test
} from "node:test";
import {
  getAuthdTestSuite
} from "../suite/get-authd-test-suite.js";
import {
  requestAuthd
} from "../support/request-authd.js";

test("invalid projected generations fail startup and readiness",
  async () => {
    const suite = getAuthdTestSuite();
    const original = await readFile(
      suite.files.providerConfigPath,
      "utf8");
    try {
      await writeFile(
        suite.files.providerConfigPath,
        '{"schema_version":1,"unexpected":true}\n',
        "utf8");
      await assert.rejects(
        suite.authd.restart(),
        /deployment|rollout|ready|timed out/iu);
    } finally {
      await writeFile(
        suite.files.providerConfigPath,
        original,
        "utf8");
      await suite.authd.restart();
    }
    const ready = await requestAuthd({
      method: "GET",
      path: "/readyz",
      probe: true
    });
    assert.equal(ready.statusCode, 204);
  });
