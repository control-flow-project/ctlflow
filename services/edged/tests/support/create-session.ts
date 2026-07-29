import {
  randomBytes
} from "node:crypto";
import type {
  TestWorkloadCredentials
} from "@ctlflow/test-mesh";
import type {
  CreateSessionResponse,
  IdentityServiceClient
} from "../generated/v1/identityd.js";
import {
  callUnary
} from "./call-unary.js";
import {
  workloadMetadata
} from "./workload-metadata.js";

export async function createSession(
  client: IdentityServiceClient,
  authd: TestWorkloadCredentials,
  providerSubject = "alice@example.com"
): Promise<string> {
  const result = await callUnary<CreateSessionResponse>((done) =>
    client.createSession(
      {
        tenantId: "acme",
        providerId: "oidc",
        providerSubject
      },
      workloadMetadata(authd.callerToken),
      done));
  return Buffer.from(result.sessionCredential)
    .toString("base64url");
}

export function createUnknownSession(): string {
  return randomBytes(32).toString("base64url");
}

export async function revokeSession(
  client: IdentityServiceClient,
  authd: TestWorkloadCredentials,
  credential: string
): Promise<void> {
  await callUnary((done) =>
    client.revokeSession(
      {
        sessionCredential: Buffer.from(credential, "base64url")
      },
      workloadMetadata(authd.callerToken),
      done));
}
