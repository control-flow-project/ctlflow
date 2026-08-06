import {
  credentials,
  type ClientOptions
} from "@grpc/grpc-js";
import {
  readFile
} from "node:fs/promises";
import type {
  OpenTelemetryCollector,
  TestWorkloadCredentials
} from "@ctlflow/test-mesh";
import type {
  PolicydProductionService
} from "@ctlflow/policyd/testing/production";
import {
  PolicyServiceClient
} from "../generated/v1/policyd.js";
import {
  getPolicydTestSuite
} from "../suite/get-policyd-test-suite.js";
import type {
  InvocationAuthority
} from "./invocation-authority.js";

export interface PolicydOwnerWorkloads {
  readonly tenantd: TestWorkloadCredentials;
  readonly pkgd: TestWorkloadCredentials;
  readonly configd: TestWorkloadCredentials;
  readonly execd: TestWorkloadCredentials;
  // A product workload outside every kernel caller set; its authority
  // resolves through Execd at decision time.
  readonly product: TestWorkloadCredentials;
  readonly unadmitted: TestWorkloadCredentials;
}

export interface PolicydTestContext {
  readonly collector: OpenTelemetryCollector;
  readonly policyd: PolicydProductionService;
  readonly invocation: InvocationAuthority;
  readonly workloads: PolicydOwnerWorkloads;
  readonly client: PolicyServiceClient;
  readonly reset: () => Promise<void>;
  readonly stop: () => Promise<void>;
}

export async function createPolicydTestContext():
Promise<PolicydTestContext> {
  const suite = getPolicydTestSuite();
  const workloads: PolicydOwnerWorkloads = {
    tenantd:
      await suite.kubernetes.createWorkloadCredentials("tenantd"),
    pkgd:
      await suite.kubernetes.createWorkloadCredentials("pkgd"),
    configd:
      await suite.kubernetes.createWorkloadCredentials("configd"),
    execd:
      await suite.kubernetes.createWorkloadCredentials("execd"),
    product:
      await suite.kubernetes.createWorkloadCredentials("product-chat"),
    unadmitted:
      await suite.kubernetes.createWorkloadCredentials("other-service")
  };
  const authority = await readFile(
    suite.policyd.certificateAuthorityPath);
  const client = new PolicyServiceClient(
    `127.0.0.1:${String(suite.policyd.process.grpcPort)}`,
    credentials.createSsl(authority),
    createClientOptions(suite.policyd.serverName));
  let stopped = false;
  return {
    collector: suite.collector,
    policyd: suite.policyd,
    invocation: suite.invocation,
    workloads,
    client,
    reset: async () => {
      await suite.collector.resume();
      await suite.collector.clearExports();
      await suite.policyd.replacePolicy({
        roles: [],
        grants: []
      });
      await suite.policyd.setPrincipalFacts([]);
      await suite.policyd.setVerificationKeys({
        keys: [suite.invocation.verificationKey],
        expiresAt: new Date(
          Date.now() + 4 * 60_000).toISOString()
      });
    },
    stop: async () => {
      if (stopped) {
        return;
      }
      stopped = true;
      client.close();
    }
  };
}

function createClientOptions(serverName: string): ClientOptions {
  return {
    "grpc.ssl_target_name_override": serverName,
    "grpc.default_authority": serverName
  };
}
