import {
  PrincipalKind,
  type ResolvePrincipalResponse
} from "../generated/v1/identityd.js";
import type {
  InvocationIdentity
} from "./invocation-identity.js";
import {
  IdentityFactSourceError
} from "./identity-fact-source-error.js";

export function validatePrincipalFacts(
  response: ResolvePrincipalResponse,
  invocation: InvocationIdentity
): void {
  if (
    response.principalId !== invocation.actorId
    || response.subjectAccountId
      !== invocation.subjectAccountId
    || response.principalRevision < 1n
    || response.subjectAccountRevision < 1n
    || response.membershipRevision < 1n
    || !isPrincipalId(response.principalId)
    || !isAccountId(response.subjectAccountId)
  ) {
    throw new IdentityFactSourceError();
  }

  switch (response.principalKind) {
    case PrincipalKind.PRINCIPAL_KIND_HUMAN:
      if (
        response.principalId
          !== response.subjectAccountId
        || !response.principalId.startsWith("user:")
      ) {
        throw new IdentityFactSourceError();
      }
      break;
    case PrincipalKind.PRINCIPAL_KIND_SERVICE:
      if (
        response.principalId
          !== response.subjectAccountId
        || !response.principalId.startsWith("service:")
      ) {
        throw new IdentityFactSourceError();
      }
      break;
    case PrincipalKind.PRINCIPAL_KIND_VIRTUAL:
      if (
        response.principalId
          === response.subjectAccountId
      ) {
        throw new IdentityFactSourceError();
      }
      break;
    default:
      throw new IdentityFactSourceError();
  }
}

function isPrincipalId(value: string): boolean {
  return value.length <= 256
    && /^[a-z][a-z_]*:[a-z0-9][a-z0-9_.-]*$/u
      .test(value);
}

function isAccountId(value: string): boolean {
  return value.startsWith("user:")
    || value.startsWith("service:");
}
