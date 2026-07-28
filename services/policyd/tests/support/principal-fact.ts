import type {
  PrincipalAuthorizationFacts
} from "@ctlflow/identityd/testing/production";

export function principalFact(
  overrides: Partial<PrincipalAuthorizationFacts> = {}
): PrincipalAuthorizationFacts {
  return {
    principalId: "user:alice",
    tenantId: "acme",
    principalKind: "human",
    principalEnabled: true,
    principalRevision: 1,
    subjectAccountId: "user:alice",
    subjectAccountEnabled: true,
    subjectAccountRevision: 1,
    membershipRevision: 1,
    groupIds: [],
    ...overrides
  };
}
