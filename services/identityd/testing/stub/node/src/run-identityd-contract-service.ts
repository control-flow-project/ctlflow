import {
  Server,
  ServerCredentials,
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
  IdentityServiceService,
  type GetInvocationVerificationKeysRequest,
  type GetInvocationVerificationKeysResponse,
  type ListPrincipalGroupsRequest,
  type ListPrincipalGroupsResponse,
  type ResolvePrincipalRequest,
  type ResolvePrincipalResponse
} from "../generated/v1/identityd.js";
import {
  getInvocationVerificationKeys
} from "./get-invocation-verification-keys.js";
import {
  handleIdentitydControl
} from "./handle-identityd-control.js";
import type {
  IdentitydStubState
} from "./identityd-stub-state.js";
import {
  listPrincipalGroups
} from "./list-principal-groups.js";
import {
  resolvePrincipal
} from "./resolve-principal.js";

const grpcPort = readPort(
  "CTLFLOW_TEST_IDENTITY_GRPC_PORT");
const controlPort = readPort(
  "CTLFLOW_TEST_IDENTITY_CONTROL_PORT");
const workloadSettings = readWorkloadSettings();
const state: IdentitydStubState = {
  sources: new Map(),
  workloadSettings,
  workloadKeys: await loadWorkloadVerificationKeys(
    workloadSettings.keySetPath)
};
const certificate = await readFile(
  requireEnvironment(
    "CTLFLOW_TEST_TLS_CERTIFICATE_PATH"));
const privateKey = await readFile(
  requireEnvironment(
    "CTLFLOW_TEST_TLS_PRIVATE_KEY_PATH"));
const server = new Server();
server.addService(IdentityServiceService, {
  getInvocationVerificationKeys: ((
    call,
    callback
  ) => {
    getInvocationVerificationKeys(
      state,
      call,
      callback);
  }) as handleUnaryCall<
    GetInvocationVerificationKeysRequest,
    GetInvocationVerificationKeysResponse
  >,
  resolvePrincipal: ((
    call,
    callback
  ) => {
    resolvePrincipal(state, call, callback);
  }) as handleUnaryCall<
    ResolvePrincipalRequest,
    ResolvePrincipalResponse
  >,
  listPrincipalGroups: ((
    call,
    callback
  ) => {
    listPrincipalGroups(state, call, callback);
  }) as handleUnaryCall<
    ListPrincipalGroupsRequest,
    ListPrincipalGroupsResponse
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
      await handleIdentitydControl(
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

function readPort(name: string): number {
  const value = Number(process.env[name]);
  if (
    !Number.isSafeInteger(value)
    || value < 1
    || value > 65_535
  ) {
    throw new Error(`${name} is invalid`);
  }
  return value;
}

function readWorkloadSettings():
WorkloadVerificationSettings {
  const maximumLifetimeSeconds = Number(
    requireEnvironment(
      "CTLFLOW_TEST_WORKLOAD_TOKEN_MAX_LIFETIME_SECONDS"));
  if (
    !Number.isSafeInteger(maximumLifetimeSeconds)
    || maximumLifetimeSeconds < 1
  ) {
    throw new Error(
      "Workload token maximum lifetime is invalid");
  }
  return {
    issuer: requireEnvironment(
      "CTLFLOW_TEST_WORKLOAD_TOKEN_ISSUER"),
    audience: requireEnvironment(
      "CTLFLOW_TEST_WORKLOAD_TOKEN_AUDIENCE"),
    maximumLifetimeSeconds,
    keySetPath: requireEnvironment(
      "CTLFLOW_TEST_WORKLOAD_JWKS_PATH")
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
  server.tryShutdown(() => process.exit(0));
}
