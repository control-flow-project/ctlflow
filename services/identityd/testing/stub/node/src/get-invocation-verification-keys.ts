import {
  status,
  type ServerUnaryCall,
  type sendUnaryData
} from "@grpc/grpc-js";
import type {
  GetInvocationVerificationKeysRequest,
  GetInvocationVerificationKeysResponse
} from "../generated/v1/identityd.js";
import {
  authenticateIdentitydSource
} from "./authenticate-identityd-source.js";
import {
  hasInvocation
} from "./has-invocation.js";
import type {
  IdentitydStubState
} from "./identityd-stub-state.js";
import {
  readTraceparent
} from "./read-traceparent.js";

export function getInvocationVerificationKeys(
  state: IdentitydStubState,
  call: ServerUnaryCall<
    GetInvocationVerificationKeysRequest,
    GetInvocationVerificationKeysResponse
  >,
  callback: sendUnaryData<
    GetInvocationVerificationKeysResponse>
): void {
  const authentication = authenticateIdentitydSource(
    state,
    call.metadata.get("authorization"));
  if (authentication.outcome !== "admitted") {
    callback({
      code: authentication.outcome === "unauthenticated"
        ? status.UNAUTHENTICATED
        : status.PERMISSION_DENIED,
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

  source.requests.push({
    operation: "GetInvocationVerificationKeys",
    receivedInvocation: hasInvocation(
      call.metadata.get("ctlflow-invocation")),
    ...readTraceparent(
      call.metadata.get("traceparent"))
  });
  callback(null, {
    keys: source.verificationKeys.keys.map((key) => ({
      ...key
    })),
    expiresAt: new Date(
      source.verificationKeys.expiresAt)
  });
}
