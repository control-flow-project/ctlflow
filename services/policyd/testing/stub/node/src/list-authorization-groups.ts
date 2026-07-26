import {
  createIdentityMetadata
} from "./create-identity-metadata.js";
import {
  callIdentity
} from "./call-identity.js";
import type {
  IdentityCallContext
} from "./identity-call-context.js";
import type {
  PolicyStubState
} from "./policy-stub-state.js";

export interface ListAuthorizationGroupsOptions {
  readonly principalId: string;
  readonly tenantId: string;
  readonly workspaceId?: string;
}

export async function listAuthorizationGroups(
  state: PolicyStubState,
  context: IdentityCallContext,
  options: ListAuthorizationGroupsOptions
): Promise<readonly string[]> {
  const groups: string[] = [];
  let afterGroupId: string | undefined;
  do {
    const page = await listPage(
      state,
      context,
      options,
      afterGroupId);
    groups.push(...page.groupIds);
    if (groups.length > 10_000) {
      throw new Error(
        "Identity Group response exceeded its bound");
    }
    afterGroupId = page.nextAfterGroupId;
  } while (afterGroupId !== undefined);
  return groups;
}

async function listPage(
  state: PolicyStubState,
  context: IdentityCallContext,
  options: ListAuthorizationGroupsOptions,
  afterGroupId: string | undefined
) {
  const metadata = await createIdentityMetadata(
    state.outboundWorkloadTokenPath,
    context);
  return await callIdentity<{
    readonly groupIds: string[];
    readonly nextAfterGroupId?: string | undefined;
  }>(
    state,
    context,
    (deadline, done) =>
      state.identityClient.listPrincipalGroups(
        {
          principalId: options.principalId,
          tenantId: options.tenantId,
          pageSize: 100,
          ...(options.workspaceId === undefined
            ? {}
            : { workspaceId: options.workspaceId }),
          ...(afterGroupId === undefined
            ? {}
            : { afterGroupId })
        },
        metadata,
        { deadline },
        done));
}
