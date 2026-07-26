import {
  isIdentityIdentifier
} from "./is-identity-identifier.js";
import {
  isPrincipalId
} from "./is-principal-id.js";

export interface PrincipalFactSelector {
  readonly principalId: string;
  readonly tenantId: string;
  readonly workspaceId?: string | undefined;
}

export function isPrincipalRequest(
  request: PrincipalFactSelector
): boolean {
  return isPrincipalId(request.principalId)
    && isIdentityIdentifier(request.tenantId)
    && (
      request.workspaceId === undefined
      || isIdentityIdentifier(request.workspaceId)
    );
}
