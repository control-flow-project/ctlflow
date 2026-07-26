import type {
  IdentitydSource
} from "./identityd-source.js";
import type {
  PrincipalAuthorizationFacts
} from "./principal-authorization-facts.js";
import type {
  PrincipalFactSelector
} from "./validate-principal-request.js";

export function findPrincipalFacts(
  source: IdentitydSource,
  selector: PrincipalFactSelector
): PrincipalAuthorizationFacts | undefined {
  return source.principalFacts.find((facts) =>
    facts.principalId === selector.principalId
    && facts.tenantId === selector.tenantId
    && facts.workspaceId === selector.workspaceId);
}
