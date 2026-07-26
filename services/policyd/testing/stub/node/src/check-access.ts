import {
  status,
  type ServiceError,
  type ServerUnaryCall,
  type sendUnaryData
} from "@grpc/grpc-js";
import {
  PrincipalKind
} from "../generated/v1/identityd.js";
import {
  AccessDecision,
  type CheckAccessRequest,
  type CheckAccessResponse
} from "../generated/v1/policyd.js";
import {
  authenticatePolicySource
} from "./authenticate-policy-source.js";
import {
  evaluateAccess
} from "./evaluate-access.js";
import {
  IdentityFactSourceError
} from "./identity-fact-source-error.js";
import type {
  IdentityCallContext
} from "./identity-call-context.js";
import {
  InvocationKeySourceError
} from "./invocation-key-source-error.js";
import {
  InvocationValidationError
} from "./invocation-validation-error.js";
import {
  listAuthorizationGroups
} from "./list-authorization-groups.js";
import {
  loadInvocationVerificationKeys
} from "./load-invocation-verification-keys.js";
import type {
  PolicyStubState
} from "./policy-stub-state.js";
import {
  readBearerToken
} from "./read-bearer-token.js";
import {
  resolveAuthorizationPrincipal
} from "./resolve-authorization-principal.js";
import {
  validateInvocationToken
} from "./validate-invocation-token.js";
import {
  validatePolicyRequest
} from "./validate-policy-request.js";
import {
  validatePrincipalFacts
} from "./validate-principal-facts.js";

export async function checkAccess(
  state: PolicyStubState,
  call: ServerUnaryCall<
    CheckAccessRequest,
    CheckAccessResponse
  >,
  callback: sendUnaryData<CheckAccessResponse>
): Promise<void> {
  const authentication = authenticatePolicySource(
    state,
    call.metadata.get("authorization"));
  if (authentication.outcome !== "admitted") {
    sendStatus(
      callback,
      authentication.outcome === "unauthenticated"
        ? status.UNAUTHENTICATED
        : status.PERMISSION_DENIED);
    return;
  }
  if (authentication.source.mode !== "available") {
    if (authentication.source.mode === "malformed") {
      callback(null, {
        decision:
          AccessDecision.ACCESS_DECISION_UNSPECIFIED
      });
      return;
    }
    if (authentication.source.mode === "blocked") {
      await waitForCancellation(call);
      sendStatus(callback, status.CANCELLED);
      return;
    }
    sendStatus(
      callback,
      authentication.source.mode === "unavailable"
        ? status.UNAVAILABLE
        : status.PERMISSION_DENIED);
    return;
  }

  const invocationToken = readBearerToken(
    call.metadata.get("ctlflow-invocation"));
  if (invocationToken === undefined) {
    sendStatus(callback, status.UNAUTHENTICATED);
    return;
  }
  const cancellation = new AbortController();
  call.on("cancelled", () => {
    cancellation.abort();
  });
  const traceparent = readTraceparent(
    call.metadata.get("traceparent"));
  const identityContext: IdentityCallContext = {
    invocationToken,
    cancellation: cancellation.signal,
    ...(traceparent === undefined
      ? {}
      : { traceparent })
  };

  try {
    const verificationKeys =
      await loadInvocationVerificationKeys(
        state,
        identityContext);
    const invocation = validateInvocationToken(
      invocationToken,
      verificationKeys,
      state.invocationSettings,
      new Date());
    const requestValidation = validatePolicyRequest(
      call.request,
      invocation);
    if (requestValidation !== "valid") {
      sendStatus(
        callback,
        requestValidation === "invalid"
          ? status.INVALID_ARGUMENT
          : requestValidation === "not-owned"
            ? status.PERMISSION_DENIED
            : status.NOT_FOUND);
      return;
    }

    authentication.source.requests.push({
      operation: call.request.operation,
      resourcePath: call.request.resourcePath,
      tenantId: call.request.tenantId,
      ...(call.request.workspaceId === undefined
        ? {}
        : { workspaceId: call.request.workspaceId }),
      actorId: invocation.actorId,
      subjectAccountId:
        invocation.subjectAccountId,
      receivedInvocation: true,
      ...(traceparent === undefined
        ? {}
        : { receivedTraceparent: traceparent })
    });
    const selector = {
      principalId: invocation.actorId,
      tenantId: call.request.tenantId,
      ...(call.request.workspaceId === undefined
        ? {}
        : { workspaceId: call.request.workspaceId })
    };
    const principal =
      await resolveAuthorizationPrincipal(
        state,
        identityContext,
        selector);
    validatePrincipalFacts(principal, invocation);

    let actorGroups: readonly string[] = [];
    let accountGroups: readonly string[] = [];
    if (
      principal.principalEnabled
      && principal.subjectAccountEnabled
    ) {
      actorGroups = validateGroups(
        await listAuthorizationGroups(
          state,
          identityContext,
          selector));
      if (
        principal.principalKind
          === PrincipalKind.PRINCIPAL_KIND_VIRTUAL
      ) {
        accountGroups = validateGroups(
          await listAuthorizationGroups(
            state,
            identityContext,
            {
              ...selector,
              principalId:
                principal.subjectAccountId
            }));
      }
    }

    callback(null, {
      decision: evaluateAccess(
        authentication.source.grants,
        call.request,
        principal,
        actorGroups,
        accountGroups)
        ? AccessDecision.ACCESS_DECISION_ALLOW
        : AccessDecision.ACCESS_DECISION_DENY
    });
  } catch (error) {
    sendStatus(
      callback,
      mapFailure(error, cancellation.signal));
  }
}

async function waitForCancellation(
  call: ServerUnaryCall<
    CheckAccessRequest,
    CheckAccessResponse
  >
): Promise<void> {
  await new Promise<void>((resolve) => {
    call.once("cancelled", resolve);
  });
}

function validateGroups(
  groups: readonly string[]
): readonly string[] {
  if (
    groups.some((groupId) =>
      !/^[a-z0-9][a-z0-9_-]{0,63}$/u.test(groupId))
    || new Set(groups).size !== groups.length
  ) {
    throw new IdentityFactSourceError();
  }
  return groups;
}

function mapFailure(
  error: unknown,
  cancellation: AbortSignal
): status {
  if (cancellation.aborted) {
    return status.CANCELLED;
  }
  if (error instanceof InvocationValidationError) {
    return status.UNAUTHENTICATED;
  }
  if (
    error instanceof InvocationKeySourceError
    || error instanceof IdentityFactSourceError
  ) {
    return status.UNAVAILABLE;
  }
  const serviceError = error as
    Partial<ServiceError>;
  if (serviceError.code === status.NOT_FOUND) {
    return status.NOT_FOUND;
  }
  if (
    serviceError.code === status.CANCELLED
    || serviceError.code === status.DEADLINE_EXCEEDED
  ) {
    return serviceError.code;
  }
  return status.UNAVAILABLE;
}

function sendStatus(
  callback: sendUnaryData<CheckAccessResponse>,
  code: status
): void {
  callback({
    code,
    message: status[code] ?? "failed"
  });
}

function readTraceparent(
  values: readonly (string | Buffer)[]
): string | undefined {
  return values.length === 1
      && typeof values[0] === "string"
    ? values[0]
    : undefined;
}
