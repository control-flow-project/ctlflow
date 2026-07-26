import type {
  CreateSessionResponse
} from "../../generated/v1/identityd.js";
import {
  getIdentitydTestContext
} from "../../suite/get-identityd-test-context.js";
import {
  callUnary
} from "../call-unary.js";
import {
  workloadMetadata
} from "../workload-metadata.js";

export async function createSession(
  providerSubject = "alice@example.com"
): Promise<CreateSessionResponse> {
  const context = getIdentitydTestContext();
  return await callUnary<CreateSessionResponse>((done) =>
    context.client.createSession(
      {
        tenantId: "acme",
        providerId: "oidc",
        providerSubject
      },
      workloadMetadata(context.authdWorkload.callerToken),
      done));
}
