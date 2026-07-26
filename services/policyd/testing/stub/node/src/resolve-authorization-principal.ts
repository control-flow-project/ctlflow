import type {
  ResolvePrincipalResponse
} from "../generated/v1/identityd.js";
import {
  callIdentity
} from "./call-identity.js";
import {
  createIdentityMetadata
} from "./create-identity-metadata.js";
import type {
  IdentityCallContext
} from "./identity-call-context.js";
import type {
  PolicyStubState
} from "./policy-stub-state.js";

export interface ResolveAuthorizationPrincipalOptions {
  readonly principalId: string;
  readonly tenantId: string;
  readonly workspaceId?: string;
}

export async function resolveAuthorizationPrincipal(
  state: PolicyStubState,
  context: IdentityCallContext,
  options: ResolveAuthorizationPrincipalOptions
): Promise<ResolvePrincipalResponse> {
  const metadata = await createIdentityMetadata(
    state.outboundWorkloadTokenPath,
    context);
  return await callIdentity(
    state,
    context,
    (deadline, done) =>
      state.identityClient.resolvePrincipal(
        {
          principalId: options.principalId,
          tenantId: options.tenantId,
          ...(options.workspaceId === undefined
            ? {}
            : { workspaceId: options.workspaceId })
        },
        metadata,
        { deadline },
        done));
}
