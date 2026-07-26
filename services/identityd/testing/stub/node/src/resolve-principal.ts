import {
  status,
  type ServerUnaryCall,
  type sendUnaryData
} from "@grpc/grpc-js";
import {
  PrincipalKind,
  type ResolvePrincipalRequest,
  type ResolvePrincipalResponse
} from "../generated/v1/identityd.js";
import {
  authenticateIdentitydSource
} from "./authenticate-identityd-source.js";
import {
  findPrincipalFacts
} from "./find-principal-facts.js";
import {
  hasInvocation
} from "./has-invocation.js";
import type {
  IdentitydStubState
} from "./identityd-stub-state.js";
import type {
  PrincipalAuthorizationKind
} from "./principal-authorization-facts.js";
import {
  readTraceparent
} from "./read-traceparent.js";
import {
  isPrincipalRequest
} from "./validate-principal-request.js";

export function resolvePrincipal(
  state: IdentitydStubState,
  call: ServerUnaryCall<
    ResolvePrincipalRequest,
    ResolvePrincipalResponse
  >,
  callback: sendUnaryData<ResolvePrincipalResponse>
): void {
  const authentication = authenticateIdentitydSource(
    state,
    call.metadata.get("authorization"));
  if (
    authentication.outcome !== "admitted"
    || !hasInvocation(
      call.metadata.get("ctlflow-invocation"))
  ) {
    callback({
      code: authentication.outcome === "unadmitted"
        ? status.PERMISSION_DENIED
        : status.UNAUTHENTICATED,
      message: authentication.outcome
    });
    return;
  }
  const source = authentication.source;
  if (source.mode !== "available") {
    callback({
      code: source.mode === "unavailable"
        ? status.UNAVAILABLE
        : status.PERMISSION_DENIED,
      message: source.mode
    });
    return;
  }
  if (!isPrincipalRequest(call.request)) {
    callback({
      code: status.INVALID_ARGUMENT,
      message: "invalid argument"
    });
    return;
  }

  source.requests.push({
    operation: "ResolvePrincipal",
    principalId: call.request.principalId,
    tenantId: call.request.tenantId,
    ...(call.request.workspaceId === undefined
      ? {}
      : { workspaceId: call.request.workspaceId }),
    receivedInvocation: true,
    ...readTraceparent(
      call.metadata.get("traceparent"))
  });
  const facts = findPrincipalFacts(
    source,
    call.request);
  if (facts === undefined) {
    callback({
      code: status.NOT_FOUND,
      message: "not found"
    });
    return;
  }

  callback(null, {
    principalId: facts.principalId,
    principalKind: mapPrincipalKind(
      facts.principalKind),
    principalEnabled: facts.principalEnabled,
    principalRevision: BigInt(
      facts.principalRevision),
    subjectAccountId: facts.subjectAccountId,
    subjectAccountEnabled:
      facts.subjectAccountEnabled,
    subjectAccountRevision: BigInt(
      facts.subjectAccountRevision),
    membershipRevision: BigInt(
      facts.membershipRevision)
  });
}

function mapPrincipalKind(
  kind: PrincipalAuthorizationKind
): PrincipalKind {
  switch (kind) {
    case "human":
      return PrincipalKind.PRINCIPAL_KIND_HUMAN;
    case "service":
      return PrincipalKind.PRINCIPAL_KIND_SERVICE;
    case "virtual":
      return PrincipalKind.PRINCIPAL_KIND_VIRTUAL;
  }
}
