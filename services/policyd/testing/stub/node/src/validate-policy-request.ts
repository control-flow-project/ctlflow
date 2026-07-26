import type {
  CheckAccessRequest
} from "../generated/v1/policyd.js";
import type {
  InvocationIdentity
} from "./invocation-identity.js";

export type PolicyRequestValidation =
  | "valid"
  | "invalid"
  | "not-owned"
  | "outside-fence";

const tenantOperations = new Set([
  "tenants.read",
  "tenants.update_display_name"
]);
const workspaceCollectionOperations = new Set([
  "workspaces.create"
]);
const workspaceExactOperations = new Set([
  "workspaces.update_display_name",
  "workspaces.suspend",
  "workspaces.resume",
  "workspaces.delete"
]);

export function validatePolicyRequest(
  request: CheckAccessRequest,
  invocation: InvocationIdentity
): PolicyRequestValidation {
  if (
    !isIdentifier(request.tenantId)
    || (
      request.workspaceId !== undefined
      && !isIdentifier(request.workspaceId)
    )
    || !isOperation(request.operation)
    || !isCanonicalPath(request.resourcePath)
  ) {
    return "invalid";
  }
  if (!isOwnedOperation(request)) {
    return "not-owned";
  }
  if (
    invocation.tenantId !== request.tenantId
    || (
      request.workspaceId !== undefined
      && invocation.workspaceId !== undefined
      && invocation.workspaceId !== request.workspaceId
    )
    || (
      isWorkspaceCollection(request)
      && invocation.workspaceId !== undefined
    )
  ) {
    return "outside-fence";
  }
  return "valid";
}

function isOwnedOperation(
  request: CheckAccessRequest
): boolean {
  const tenantPath =
    `/tenants/${request.tenantId}`;
  if (tenantOperations.has(request.operation)) {
    return request.workspaceId === undefined
      && request.resourcePath === tenantPath;
  }

  const collectionPath =
    `${tenantPath}/workspaces`;
  if (
    workspaceCollectionOperations.has(
      request.operation)
  ) {
    return request.workspaceId === undefined
      && request.resourcePath === collectionPath;
  }
  if (request.operation === "workspaces.read") {
    return request.resourcePath
      === (
        request.workspaceId === undefined
          ? collectionPath
          : `${collectionPath}/${request.workspaceId}`
      );
  }
  if (
    workspaceExactOperations.has(request.operation)
  ) {
    return request.workspaceId !== undefined
      && request.resourcePath
        === `${collectionPath}/${request.workspaceId}`;
  }
  return false;
}

function isWorkspaceCollection(
  request: CheckAccessRequest
): boolean {
  return request.workspaceId === undefined
    && (
      workspaceCollectionOperations.has(
        request.operation)
      || request.operation === "workspaces.read"
    );
}

function isIdentifier(value: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{0,63}$/u.test(value);
}

function isOperation(value: string): boolean {
  return /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/u
    .test(value)
    && value.length <= 128;
}

function isCanonicalPath(value: string): boolean {
  return value.length <= 512
    && value.startsWith("/")
    && !value.includes("//")
    && value.split("/").slice(1).every(
      (segment) =>
        segment.length > 0
        && segment !== "."
        && segment !== ".."
        && !segment.includes("\0"));
}
