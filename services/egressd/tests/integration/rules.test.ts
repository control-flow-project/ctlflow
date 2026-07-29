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

test("selects longest and exact rules and preserves the query", async () => {
  const suite = getEgressdTestSuite();
  await suite.origin.clearEvidence();
  assert.equal(
    (await requestEgressd({ path: "/api?source=exact" })).statusCode,
    200);
  assert.equal(
    (await requestEgressd({
      method: "POST",
      path: "/api?source=prefix"
    })).statusCode,
    200);
  assert.equal(
    (await requestEgressd({
      path: "/api/item?encoded=%2B&repeat=1&repeat=2"
    })).statusCode,
    200);
  assert.equal(
    (await requestEgressd({
      path: "/nested/deep/item?source=longest"
    })).statusCode,
    200);
  assert.equal(
    (await requestEgressd({ path: "/nestedness" })).statusCode,
    404);
  const evidence = await suite.origin.readEvidence();
  assert.deepEqual(
    evidence.map((entry) => entry.target),
    [
      "/exact?source=exact",
      "/v2?source=prefix",
      "/v2/item?encoded=%2B&repeat=1&repeat=2",
      "/deep/item?source=longest"
    ]);
});

test("returns not found when no rule admits the path", async () => {
  const response = await requestEgressd({ path: "/missing" });
  assert.equal(response.statusCode, 404);
  assert.equal(response.body.toString(), "Not found\n");
});

test("returns the sorted method union for a matched path", async () => {
  const response = await requestEgressd({
    method: "PATCH",
    path: "/method"
  });
  assert.equal(response.statusCode, 405);
  assert.equal(response.headers.get("allow")?.[0], "DELETE, GET");
  assert.equal(response.body.toString(), "Method not allowed\n");

  const api = await requestEgressd({
    method: "PUT",
    path: "/api"
  });
  assert.equal(api.statusCode, 405);
  assert.equal(api.headers.get("allow")?.[0], "GET, POST");
});

test("rejects unsafe or malformed request targets", async () => {
  const cases = [
    {
      path: "https://external.invalid/path",
      headers: [["Host", "external.invalid"]] as const
    },
    ...[
    "//external.invalid/path",
    "/nested/%2fescape",
    "/nested/%5cescape",
    "/nested/%GG",
    "/nested/%00",
    "/nested/item?value=%0A",
    "/nested/../escape",
    "/nested/./escape",
    "/nested/path#fragment"
    ].map((path) => ({ path, headers: [] as const }))
  ];
  for (const invalid of cases) {
    const response = await requestEgressd({
      path: invalid.path,
      headers: invalid.headers
    });
    assert.equal(response.statusCode, 400, invalid.path);
    if (invalid.path !== "/nested/%00") {
      assert.equal(
        response.body.toString(),
        "Bad request\n",
        invalid.path);
    }
  }
});
