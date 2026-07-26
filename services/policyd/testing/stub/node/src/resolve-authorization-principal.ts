import type {
  ResolvePrincipalResponse
} from "../generated/v1/identityd.js";
import type {
  ClientUnaryCall
} from "@grpc/grpc-js";
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
  return await new Promise((resolve, reject) => {
    let call: ClientUnaryCall | undefined;
    const cancel = () => {
      call?.cancel();
    };
    context.cancellation.addEventListener(
      "abort",
      cancel,
      { once: true });
    call = state.identityClient.resolvePrincipal(
      {
        principalId: options.principalId,
        tenantId: options.tenantId,
        ...(options.workspaceId === undefined
          ? {}
          : { workspaceId: options.workspaceId })
      },
      metadata,
      {
        deadline: new Date(
          Date.now()
          + state.identityCallTimeoutMilliseconds)
      },
      (error, response) => {
        context.cancellation.removeEventListener(
          "abort",
          cancel);
        if (error === null) {
          resolve(response);
        } else {
          reject(error);
        }
      });
    if (context.cancellation.aborted) {
      cancel();
    }
  });
}
