import {
  PrincipalKind,
  type ResolvePrincipalResponse
} from "../generated/v1/identityd.js";
import type {
  CheckAccessRequest
} from "../generated/v1/policyd.js";
import type {
  PolicyGrant
} from "./policy-grant.js";

export function evaluateAccess(
  grants: readonly PolicyGrant[],
  request: CheckAccessRequest,
  principal: ResolvePrincipalResponse,
  actorGroups: readonly string[],
  accountGroups: readonly string[]
): boolean {
  if (
    !principal.principalEnabled
    || !principal.subjectAccountEnabled
  ) {
    return false;
  }

  const actorAllowed = hasMatchingGrant(
    grants,
    request,
    [
      principal.principalId,
      ...actorGroups
    ]);
  if (
    principal.principalKind
      !== PrincipalKind.PRINCIPAL_KIND_VIRTUAL
  ) {
    return actorAllowed;
  }

  return actorAllowed
    && hasMatchingGrant(
      grants,
      request,
      [
        principal.subjectAccountId,
        ...accountGroups
      ]);
}

function hasMatchingGrant(
  grants: readonly PolicyGrant[],
  request: CheckAccessRequest,
  subjects: readonly string[]
): boolean {
  const subjectSet = new Set(subjects);
  return grants.some((grant) =>
    subjectSet.has(grant.subjectId)
    && grant.operation === request.operation
    && (
      grant.match === "exact"
        ? grant.resourcePath === request.resourcePath
        : request.resourcePath === grant.resourcePath
          || request.resourcePath.startsWith(
            `${grant.resourcePath}/`)
    ));
}
