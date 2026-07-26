import {
  status,
  type ServerUnaryCall,
  type sendUnaryData
} from "@grpc/grpc-js";
import type {
  ListPrincipalGroupsRequest,
  ListPrincipalGroupsResponse
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
import {
  readTraceparent
} from "./read-traceparent.js";
import {
  isIdentityIdentifier
} from "./is-identity-identifier.js";
import {
  isPrincipalRequest
} from "./validate-principal-request.js";

export function listPrincipalGroups(
  state: IdentitydStubState,
  call: ServerUnaryCall<
    ListPrincipalGroupsRequest,
    ListPrincipalGroupsResponse
  >,
  callback: sendUnaryData<ListPrincipalGroupsResponse>
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
  if (
    !isPrincipalRequest(call.request)
    || call.request.pageSize > 100
    || (
      call.request.afterGroupId !== undefined
      && !isIdentityIdentifier(
        call.request.afterGroupId)
    )
  ) {
    callback({
      code: status.INVALID_ARGUMENT,
      message: "invalid argument"
    });
    return;
  }

  source.requests.push({
    operation: "ListPrincipalGroups",
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

  const pageSize = call.request.pageSize === 0
    ? 50
    : call.request.pageSize;
  const groups = [...facts.groupIds]
    .filter((groupId) =>
      call.request.afterGroupId === undefined
      || groupId > call.request.afterGroupId)
    .sort(compareOrdinal)
    .slice(0, pageSize + 1);
  const hasNext = groups.length > pageSize;
  const page = groups.slice(0, pageSize);
  callback(null, {
    groupIds: page,
    ...(hasNext
      ? {
          nextAfterGroupId:
            page[page.length - 1]
        }
      : {})
  });
}

function compareOrdinal(
  left: string,
  right: string
): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
