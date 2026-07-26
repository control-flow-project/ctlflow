import {
  credentials,
  Server,
  ServerCredentials,
  type ClientOptions,
  type handleUnaryCall
} from "@grpc/grpc-js";
import {
  loadWorkloadVerificationKeys,
  type WorkloadVerificationSettings
} from "@ctlflow/test-mesh";
import {
  readFile
} from "node:fs/promises";
import http from "node:http";
import {
  IdentityServiceClient
} from "../generated/v1/identityd.js";
import {
  PolicyServiceService,
  type CheckAccessRequest,
  type CheckAccessResponse
} from "../generated/v1/policyd.js";
import {
  checkAccess
} from "./check-access.js";
import {
  handlePolicyControl
} from "./handle-policy-control.js";
import type {
  InvocationValidationSettings
} from "./invocation-validation-settings.js";
import type {
  PolicyStubState
} from "./policy-stub-state.js";

const grpcPort = readPort(
  "CTLFLOW_TEST_POLICY_GRPC_PORT");
const controlPort = readPort(
  "CTLFLOW_TEST_POLICY_CONTROL_PORT");
const workloadSettings = readWorkloadSettings();
const identityServerName = requireEnvironment(
  "CTLFLOW_TEST_IDENTITY_TLS_SERVER_NAME");
const identityEndpoint = readGrpcEndpoint(
  requireEnvironment("CTLFLOW_TEST_IDENTITY_URL"));
const identityCredentials = credentials.createSsl(
  await readFile(
    requireEnvironment(
      "CTLFLOW_TEST_IDENTITY_TLS_CA_PATH")));
const identityClientOptions =
  createClientOptions(identityServerName);
const createIdentityClient = () =>
  new IdentityServiceClient(
    identityEndpoint,
    identityCredentials,
    identityClientOptions);
const state: PolicyStubState = {
  sources: new Map(),
  workloadSettings,
  workloadKeys: await loadWorkloadVerificationKeys(
    workloadSettings.keySetPath),
  identityClient: createIdentityClient(),
  createIdentityClient,
  identityCallTimeoutMilliseconds: readPositiveInteger(
    "CTLFLOW_TEST_IDENTITY_CALL_TIMEOUT_MILLISECONDS"),
  outboundWorkloadTokenPath: requireEnvironment(
    "CTLFLOW_TEST_OUTBOUND_WORKLOAD_TOKEN_PATH"),
  invocationSettings: readInvocationSettings()
};
const certificate = await readFile(
  requireEnvironment(
    "CTLFLOW_TEST_TLS_CERTIFICATE_PATH"));
const privateKey = await readFile(
  requireEnvironment(
    "CTLFLOW_TEST_TLS_PRIVATE_KEY_PATH"));
const server = new Server();
server.addService(PolicyServiceService, {
  checkAccess: ((
    call,
    callback
  ) => {
    void checkAccess(state, call, callback);
  }) as handleUnaryCall<
    CheckAccessRequest,
    CheckAccessResponse
  >
});
await new Promise<void>((resolve, reject) => {
  server.bindAsync(
    `0.0.0.0:${String(grpcPort)}`,
    ServerCredentials.createSsl(
      null,
      [{
        cert_chain: certificate,
        private_key: privateKey
      }],
      false),
    (error) => {
      if (error === null) {
        resolve();
      } else {
        reject(error);
      }
    });
});

const control = http.createServer(
  async (request, response) => {
    try {
      await handlePolicyControl(
        state,
        request,
        response);
    } catch (error) {
      response.writeHead(400, {
        "content-type": "text/plain"
      });
      response.end(
        error instanceof Error
          ? error.message
          : "invalid request");
    }
  });
await new Promise<void>((resolve, reject) => {
  control.once("error", reject);
  control.listen(controlPort, "0.0.0.0", resolve);
});

process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);

function readInvocationSettings():
InvocationValidationSettings {
  return {
    issuer: requireEnvironment(
      "CTLFLOW_TEST_INVOCATION_TOKEN_ISSUER"),
    audience: requireEnvironment(
      "CTLFLOW_TEST_INVOCATION_TOKEN_AUDIENCE"),
    maximumLifetimeSeconds: readPositiveInteger(
      "CTLFLOW_TEST_INVOCATION_TOKEN_MAX_LIFETIME_SECONDS")
  };
}

function readWorkloadSettings():
WorkloadVerificationSettings {
  return {
    issuer: requireEnvironment(
      "CTLFLOW_TEST_WORKLOAD_TOKEN_ISSUER"),
    audience: requireEnvironment(
      "CTLFLOW_TEST_WORKLOAD_TOKEN_AUDIENCE"),
    maximumLifetimeSeconds: readPositiveInteger(
      "CTLFLOW_TEST_WORKLOAD_TOKEN_MAX_LIFETIME_SECONDS"),
    keySetPath: requireEnvironment(
      "CTLFLOW_TEST_WORKLOAD_JWKS_PATH")
  };
}

function readPort(name: string): number {
  const value = readPositiveInteger(name);
  if (value > 65_535) {
    throw new Error(`${name} is invalid`);
  }
  return value;
}

function readPositiveInteger(name: string): number {
  const value = Number(process.env[name]);
  if (
    !Number.isSafeInteger(value)
    || value < 1
  ) {
    throw new Error(`${name} is invalid`);
  }
  return value;
}

function readGrpcEndpoint(value: string): string {
  const endpoint = new URL(value);
  if (
    endpoint.protocol !== "https:"
    || endpoint.pathname !== "/"
    || endpoint.search.length > 0
    || endpoint.hash.length > 0
  ) {
    throw new Error("Identity endpoint is invalid");
  }
  return endpoint.host;
}

function createClientOptions(
  serverName: string
): ClientOptions {
  return {
    "grpc.ssl_target_name_override": serverName,
    "grpc.default_authority": serverName,
    "grpc.initial_reconnect_backoff_ms": 100,
    "grpc.min_reconnect_backoff_ms": 100,
    "grpc.max_reconnect_backoff_ms": 500
  };
}

function requireEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function shutdown(): void {
  control.close();
  server.tryShutdown(() => {
    state.identityClient.close();
    process.exit(0);
  });
}
