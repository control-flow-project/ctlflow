import type {
  PrincipalAuthorizationFacts,
  PrincipalAuthorizationKind
} from "@ctlflow/identityd/testing/production";
import type {
  CapabilityGrant
} from "./capability-grant.js";
import type {
  TenantdTestContext
} from "../create-tenantd-test-context.js";

export interface ConfigureCapabilityPolicyOptions {
  readonly tenantId: string;
  readonly workspaceId?: string;
  readonly actorId?: string;
  readonly subjectAccountId?: string;
  readonly principalKind?: PrincipalAuthorizationKind;
  readonly principalEnabled?: boolean;
  readonly subjectAccountEnabled?: boolean;
  readonly actorGroups?: readonly string[];
  readonly accountGroups?: readonly string[];
  readonly grants: readonly CapabilityGrant[];
}

export async function configureCapabilityPolicy(
  context: TenantdTestContext,
  options: ConfigureCapabilityPolicyOptions
): Promise<void> {
  const actorId = options.actorId ?? "user:alice";
  const subjectAccountId =
    options.subjectAccountId ?? actorId;
  const principalKind = options.principalKind
    ?? inferPrincipalKind(actorId, subjectAccountId);
  const facts: PrincipalAuthorizationFacts[] = [{
    principalId: actorId,
    tenantId: options.tenantId,
    ...(options.workspaceId === undefined
      ? {}
      : { workspaceId: options.workspaceId }),
    principalKind,
    principalEnabled: options.principalEnabled ?? true,
    principalRevision: 1,
    subjectAccountId,
    subjectAccountEnabled:
      options.subjectAccountEnabled ?? true,
    subjectAccountRevision: 1,
    membershipRevision: 1,
    groupIds: options.actorGroups ?? []
  }];
  if (principalKind === "virtual") {
    facts.push({
      principalId: subjectAccountId,
      tenantId: options.tenantId,
      ...(options.workspaceId === undefined
        ? {}
        : { workspaceId: options.workspaceId }),
      principalKind: subjectAccountId.startsWith("user:")
        ? "human"
        : "service",
      principalEnabled:
        options.subjectAccountEnabled ?? true,
      principalRevision: 1,
      subjectAccountId,
      subjectAccountEnabled:
        options.subjectAccountEnabled ?? true,
      subjectAccountRevision: 1,
      membershipRevision: 1,
      groupIds: options.accountGroups ?? []
    });
  }

  await context.policyd.setPrincipalFacts(facts);
  await context.policyd.replacePolicy({
    roles: [],
    grants: options.grants.map((grant) => ({
      ...grant,
      target: {
        tenantId: options.tenantId,
        ...(options.workspaceId === undefined
          ? {}
          : { workspaceId: options.workspaceId })
      }
    }))
  });
}

function inferPrincipalKind(
  actorId: string,
  subjectAccountId: string
): PrincipalAuthorizationKind {
  if (actorId !== subjectAccountId) {
    return "virtual";
  }
  return actorId.startsWith("user:")
    ? "human"
    : "service";
}
