import assert from "node:assert/strict";
import { test } from "node:test";
import {
  IdentityServiceService
} from "../generated/v1/identityd.js";
import {
  getIdentitydTestContext
} from "../suite/get-identityd-test-context.js";
import {
  readProbeStatus
} from "../support/read-probe-status.js";

test("identityd exposes exactly the approved RPC inventory", () => {
  assert.deepEqual(
    Object.keys(IdentityServiceService),
    [
      "getInvocationVerificationKeys",
      "resolvePrincipal",
      "listPrincipalGroups",
      "addTenantMember",
      "removeTenantMember",
      "listTenantMembers",
      "addWorkspaceMember",
      "removeWorkspaceMember",
      "listWorkspaceMembers",
      "createGroup",
      "deleteGroup",
      "listGroups",
      "addGroupMember",
      "removeGroupMember",
      "listGroupMembers",
      "createVirtualPrincipal",
      "getVirtualPrincipal",
      "listVirtualPrincipals",
      "setVirtualPrincipalEnabled",
      "createExternalIdentityLink",
      "deleteExternalIdentityLink",
      "listExternalIdentityLinks",
      "createLoginProvider",
      "getLoginProvider",
      "listLoginProviders",
      "updateLoginProvider",
      "setLoginProviderState",
      "setWorkspaceLoginProviderAdmission",
      "listWorkspaceLoginProviderAdmissions",
      "createSession",
      "exchangeSession",
      "revokeSession",
      "issueRunInvocation"
    ]);
});

test("identityd health and readiness probes are available", async () => {
  const context = getIdentitydTestContext();
  assert.equal(await readProbeStatus(context.probePort, "/healthz"), 204);
  assert.equal(await readProbeStatus(context.probePort, "/readyz"), 204);
});
