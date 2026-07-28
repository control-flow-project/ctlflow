import assert from "node:assert/strict";
import {
  test
} from "node:test";
import {
  PolicyServiceService
} from "../generated/v1/policyd.js";

test("publishes exactly the approved unary CheckAccess API", () => {
  assert.deepEqual(
    Object.keys(PolicyServiceService),
    ["checkAccess"]);
  assert.equal(
    PolicyServiceService.checkAccess.path,
    "/ctlflow.policy.v1.PolicyService/CheckAccess");
  assert.equal(PolicyServiceService.checkAccess.requestStream, false);
  assert.equal(PolicyServiceService.checkAccess.responseStream, false);
});
