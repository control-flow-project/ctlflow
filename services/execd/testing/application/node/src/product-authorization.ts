import {
  readFile
} from "node:fs/promises";
import {
  ChannelCredentials,
  Metadata,
  credentials,
  type ServiceError
} from "@grpc/grpc-js";
import {
  IdentityServiceClient,
  type GetInvocationVerificationKeysResponse
} from "./generated/v1/identityd.js";
import {
  AccessDecision,
  PolicyServiceClient,
  type CheckAccessResponse
} from "./generated/v1/policyd.js";
import {
  parseSignedInvocation
} from "./invocations/parse-signed-invocation.js";
import type {
  SignedInvocation
} from "./invocations/signed-invocation.js";
import {
  validateInvocation
} from "./invocations/validate-invocation.js";
import {
  validateVerificationKeyResponse
} from
  "./verification-keys/validate-verification-key-response.js";
import {
  createTraceParent
} from "./trace-context/create-trace-parent.js";

// The real product runtime call, made from inside the realized container
// using only the projected bootstrap: the rotating workload token file, the
// projected trust material, and the bootstrap environment. Nothing here is
// test-injected beyond the incoming request itself.
const maximumInvocationLifetimeSeconds = 60;

export interface ProductCheckRequest {
  readonly operation: string;
  readonly resourcePath: string;
  readonly tenantId: string;
  readonly workspaceId?: string;
  // Absent for a finite Run: the product then uses the invocation Execd
  // projected for it, exactly as a real Run does.
  readonly invocationToken?: string;
}

const runInvocationPath = "/run/ctlflow/invocation/token";

// One bounded key cache and one client per endpoint, as a receiving service
// keeps them: keys are reused until the owner-supplied expiry and refreshed on
// expiry or an unknown key ID.
interface KeyCache {
  readonly keys: GetInvocationVerificationKeysResponse;
  readonly expiresAtMs: number;
}

let keyCache: KeyCache | undefined;
let identityClient: IdentityServiceClient | undefined;
let policyClient: PolicyServiceClient | undefined;

export interface ProductCheckResult {
  readonly decision?: "allow" | "deny";
  readonly error?: {
    readonly stage: "bootstrap" | "invocation" | "policy";
    readonly code?: number | undefined;
    readonly message?: string | undefined;
  };
}

export async function checkProductAccess(
  request: ProductCheckRequest,
  incomingTraceParent?: string
): Promise<ProductCheckResult> {
  const traceParent = createTraceParent(incomingTraceParent);
  let bootstrap: Bootstrap;
  let workloadToken: string;
  try {
    bootstrap = readBootstrap();
    // Reread per call so Kubernetes token rotation is observed.
    workloadToken =
      (await readFile(bootstrap.tokenFile, "utf8")).trim();
  } catch (error) {
    // The product cannot present its own identity; it never proceeds.
    return {
      error: {
        stage: "bootstrap",
        message: (error as Error).message
      }
    };
  }

  let invocationToken: string;
  try {
    invocationToken = request.invocationToken
      ?? (await readFile(runInvocationPath, "utf8")).trim();
  } catch (error) {
    return {
      error: {
        stage: "invocation",
        message: (error as Error).message
      }
    };
  }

  let invocation: SignedInvocation;
  try {
    invocation = parseSignedInvocation(invocationToken);
  } catch (error) {
    return {
      error: {
        stage: "invocation",
        message: (error as Error).message
      }
    };
  }

  // A key-bootstrap failure is an invocation-stage failure: the product
  // cannot establish who is calling, so it never proceeds to a decision.
  let keys: GetInvocationVerificationKeysResponse;
  try {
    keys = await currentVerificationKeys(
      bootstrap,
      workloadToken,
      invocation.keyId,
      traceParent);
  } catch (error) {
    return {
      error: {
        stage: "invocation",
        code: (error as Partial<ServiceError>).code
      }
    };
  }

  let verified: boolean;
  try {
    verified = validateInvocation(
      invocation,
      keys,
      {
        issuer: bootstrap.invocationIssuer,
        audience: bootstrap.invocationAudience,
        maximumLifetimeSeconds: maximumInvocationLifetimeSeconds
      },
      {
        tenantId: request.tenantId,
        ...(request.workspaceId === undefined
          ? {}
          : { workspaceId: request.workspaceId })
      });
  } catch (error) {
    return {
      error: {
        stage: "invocation",
        message: (error as Error).message
      }
    };
  }
  if (!verified) {
    return { error: { stage: "invocation" } };
  }

  try {
    const response = await callCheckAccess(
      bootstrap,
      workloadToken,
      request,
      invocationToken,
      traceParent);
    switch (response.decision) {
      case AccessDecision.ACCESS_DECISION_ALLOW:
        return { decision: "allow" };
      case AccessDecision.ACCESS_DECISION_DENY:
        return { decision: "deny" };
      default:
        return { error: { stage: "policy" } };
    }
  } catch (error) {
    return {
      error: {
        stage: "policy",
        code: (error as Partial<ServiceError>).code
      }
    };
  }
}

export function readBootstrapSummary(): Record<string, unknown> {
  const bootstrap = readBootstrap();
  return {
    appId: bootstrap.appId,
    tokenFile: bootstrap.tokenFile,
    jwksPath: bootstrap.jwksPath,
    identitydEndpoint: bootstrap.identitydEndpoint,
    policydEndpoint: bootstrap.policydEndpoint
  };
}

interface Bootstrap {
  readonly tokenFile: string;
  readonly jwksPath: string;
  readonly identitydEndpoint: string;
  readonly identitydCaPath: string;
  readonly policydEndpoint: string;
  readonly policydCaPath: string;
  readonly invocationIssuer: string;
  readonly invocationAudience: string;
  readonly appId: string;
}

function readBootstrap(): Bootstrap {
  return {
    tokenFile: requireEnvironment("CTLFLOW_WORKLOAD_TOKEN_FILE"),
    jwksPath: requireEnvironment("CTLFLOW_WORKLOAD_JWKS_PATH"),
    identitydEndpoint: requireEnvironment("CTLFLOW_IDENTITYD_ENDPOINT"),
    identitydCaPath: requireEnvironment("CTLFLOW_IDENTITYD_TLS_CA_PATH"),
    policydEndpoint: requireEnvironment("CTLFLOW_POLICYD_ENDPOINT"),
    policydCaPath: requireEnvironment("CTLFLOW_POLICYD_TLS_CA_PATH"),
    invocationIssuer: requireEnvironment("CTLFLOW_INVOCATION_ISSUER"),
    invocationAudience: requireEnvironment("CTLFLOW_INVOCATION_AUDIENCE"),
    appId: requireEnvironment("CTLFLOW_APP_ID")
  };
}

function requireEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is not projected`);
  }
  return value;
}

async function createChannel(
  caPath: string
): Promise<ChannelCredentials> {
  return credentials.createSsl(await readFile(caPath));
}

function grpcTarget(endpoint: string): string {
  const url = new URL(endpoint);
  return `${url.hostname}:${url.port.length > 0 ? url.port : "443"}`;
}

// A known key in a current cache stays usable during an Identityd outage; an
// expired cache or an unknown key ID forces one refresh.
async function currentVerificationKeys(
  bootstrap: Bootstrap,
  workloadToken: string,
  requestedKeyId: string,
  traceParent: string
): Promise<GetInvocationVerificationKeysResponse> {
  const current = keyCache;
  if (current !== undefined
      && current.expiresAtMs > Date.now()
      && current.keys.keys.some(
        (key) => key.keyId === requestedKeyId)) {
    return current.keys;
  }

  const refreshed = await fetchVerificationKeys(
    bootstrap,
    workloadToken,
    traceParent);
  // A failed, expired, or malformed refresh is never usable, not even for
  // the request that triggered it.
  let expiresAtMs: number;
  try {
    expiresAtMs = validateVerificationKeyResponse(refreshed, Date.now());
  } catch (error) {
    keyCache = undefined;
    throw error;
  }

  keyCache = {
    keys: refreshed,
    expiresAtMs
  };
  return refreshed;
}

async function fetchVerificationKeys(
  bootstrap: Bootstrap,
  workloadToken: string,
  traceParent: string
): Promise<GetInvocationVerificationKeysResponse> {
  identityClient ??= new IdentityServiceClient(
    grpcTarget(bootstrap.identitydEndpoint),
    await createChannel(bootstrap.identitydCaPath));
  const client = identityClient;
  const metadata = new Metadata();
  metadata.set("authorization", `Bearer ${workloadToken}`);
  metadata.set("traceparent", traceParent);
  return await new Promise((resolve, reject) => {
    client.getInvocationVerificationKeys(
      {},
      metadata,
      { deadline: Date.now() + 5_000 },
      (error, response) =>
        error === null ? resolve(response) : reject(error));
  });
}
async function callCheckAccess(
  bootstrap: Bootstrap,
  workloadToken: string,
  request: ProductCheckRequest,
  invocationToken: string,
  traceParent: string
): Promise<CheckAccessResponse> {
  policyClient ??= new PolicyServiceClient(
    grpcTarget(bootstrap.policydEndpoint),
    await createChannel(bootstrap.policydCaPath));
  const client = policyClient;
  const metadata = new Metadata();
  metadata.set("authorization", `Bearer ${workloadToken}`);
  metadata.set(
    "ctlflow-invocation",
    `Bearer ${invocationToken}`);
  metadata.set("traceparent", traceParent);
  return await new Promise((resolve, reject) => {
    client.checkAccess(
      {
        operation: request.operation,
        resourcePath: request.resourcePath,
        tenantId: request.tenantId,
        workspaceId: request.workspaceId
      },
      metadata,
      { deadline: Date.now() + 10_000 },
      (error, response) =>
        error === null ? resolve(response) : reject(error));
  });
}
