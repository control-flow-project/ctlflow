import { credentials } from "@grpc/grpc-js";
import { setTimeout as delay } from "node:timers/promises";
import {
  findAvailablePort,
  startCSharpService,
  type CSharpService,
  type OpenTelemetryCollector,
  type TestAggregationCredentials,
  type TestKubernetesApiCredentials,
  type TestLifecycleOwnerCredentials,
  type TestWorkloadCredentials
} from "@ctlflow/test-mesh";
import {
  LifecycleState,
  TenantServiceClient,
} from "../generated/v1/tenantd.js";
import { createInvocationAuthority } from "./create-invocation-authority.js";
import { createTestDatabase } from "./create-test-database.js";
import { insertAddressBinding } from "./insert-address-binding.js";
import { insertTenant } from "./insert-tenant.js";
import { insertWorkspace } from "./insert-workspace.js";
import {
  insertWorkspaceAddressBinding
} from "./insert-workspace-address-binding.js";
import type { InvocationAuthority } from "./invocation-authority.js";
import { requestTenancyApi } from "./request-tenancy-api.js";
import type { TestDatabase } from "./test-database.js";
import {
  getTenantdTestSuite
} from "../suite/get-tenantd-test-suite.js";
import type {
  AuditdTestSource
} from "../dependencies/auditd/auditd-test-source.js";

export type RetainedTenant = readonly [
  id: string,
  lifecycle: LifecycleState,
  revision: number
];

export interface ResolvableWorkspace {
  readonly tenantId: string;
  readonly address: string;
  readonly id: string;
  readonly lifecycle: LifecycleState;
  readonly revision: number;
  readonly generation: number;
}

export interface TenantdTestContext {
  readonly kubernetes: TestWorkloadCredentials;
  readonly kubernetesApi: TestKubernetesApiCredentials;
  readonly aggregation: TestAggregationCredentials;
  readonly lifecycleOwners: TestLifecycleOwnerCredentials;
  readonly collector: OpenTelemetryCollector;
  readonly invocation: InvocationAuthority;
  readonly auditd: AuditdTestSource;
  readonly database: TestDatabase;
  readonly service: CSharpService;
  readonly client: TenantServiceClient;
  readonly retainedTenants: readonly RetainedTenant[];
  readonly activeWorkspace: ResolvableWorkspace;
  readonly grpcPort: number;
  readonly probePort: number;
  readonly aggregationPort: number;
  readonly stop: () => Promise<void>;
}

export interface TenantdTestContextOptions {
  readonly auditOutboxCapacity?: number;
  readonly registerAggregatedApi?: boolean;
  readonly seedResolutionData?: boolean;
}

const retainedTenants: readonly RetainedTenant[] = [
  ["tenant_provisioning", LifecycleState.LIFECYCLE_STATE_PROVISIONING, 11],
  ["tenant_active", LifecycleState.LIFECYCLE_STATE_ACTIVE, 12],
  ["tenant_suspended", LifecycleState.LIFECYCLE_STATE_SUSPENDED, 13],
  ["tenant_deleting", LifecycleState.LIFECYCLE_STATE_DELETING, 14],
  ["tenant_failed", LifecycleState.LIFECYCLE_STATE_FAILED, 15],
  ["tenant_deleted", LifecycleState.LIFECYCLE_STATE_DELETED, 16]
];

const activeWorkspace: ResolvableWorkspace = {
  tenantId: "tenant_active",
  address: "alpha",
  id: "workspace_active",
  lifecycle: LifecycleState.LIFECYCLE_STATE_ACTIVE,
  revision: 22,
  generation: 5
};

export async function createTenantdTestContext():
Promise<TenantdTestContext>;
export async function createTenantdTestContext(
  options: TenantdTestContextOptions
): Promise<TenantdTestContext>;
export async function createTenantdTestContext(
  options: TenantdTestContextOptions = {}
):
Promise<TenantdTestContext> {
  const suite = getTenantdTestSuite();
  let kubernetes: TestWorkloadCredentials | undefined;
  let lifecycleOwners: TestLifecycleOwnerCredentials | undefined;
  let invocation: InvocationAuthority | undefined;
  let database: TestDatabase | undefined;
  let auditd: AuditdTestSource | undefined;
  let service: CSharpService | undefined;
  let client: TenantServiceClient | undefined;
  try {
    await suite.collector.resume();
    await suite.collector.clearExports();
    kubernetes = await suite.kubernetes.createWorkloadCredentials();
    lifecycleOwners =
      await suite.kubernetes.createLifecycleOwnerCredentials();
    invocation = await createInvocationAuthority(
      suite.repositoryRoot);
    auditd = await suite.auditd.createSource();
    database = await createTestDatabase();
    if (options.auditOutboxCapacity !== undefined) {
      await setAuditOutboxCapacity(
        database,
        options.auditOutboxCapacity);
    }

    if (options.seedResolutionData ?? true) {
      await seedResolutionRecords(database);
    }

    const grpcPort = await findAvailablePort();
    let probePort = await findAvailablePort();
    while (probePort === grpcPort) {
      probePort = await findAvailablePort();
    }
    let aggregationPort = await findAvailablePort();
    while (
      aggregationPort === grpcPort
      || aggregationPort === probePort
    ) {
      aggregationPort = await findAvailablePort();
    }

    const environment = {
      CTLFLOW_GRPC_URL: `http://127.0.0.1:${String(grpcPort)}`,
      CTLFLOW_PROBE_URL: `http://127.0.0.1:${String(probePort)}`,
      CTLFLOW_AGGREGATION_URL:
        `https://0.0.0.0:${String(aggregationPort)}`,
      CTLFLOW_AGGREGATION_CERT_PATH:
        suite.kubernetes.aggregation.serverCertificatePath,
      CTLFLOW_AGGREGATION_KEY_PATH:
        suite.kubernetes.aggregation.serverKeyPath,
      CTLFLOW_AGGREGATION_REQUESTHEADER_CA_PATH:
        suite.kubernetes.aggregation
          .requestHeaderCertificateAuthorityPath,
      CTLFLOW_AGGREGATION_ALLOWED_CLIENT_NAMES:
        suite.kubernetes.aggregation.allowedClientName,
      CTLFLOW_DATABASE_PATH: database.path,
      CTLFLOW_DATABASE_POOL_SIZE: "4",
      CTLFLOW_AUDIT_URL: suite.auditd.endpoint,
      CTLFLOW_AUDIT_TOKEN_FILE: auditd.tokenFile,
      CTLFLOW_AUDIT_LEASE_MILLISECONDS: "500",
      CTLFLOW_AUDIT_CALL_TIMEOUT_MILLISECONDS: "200",
      CTLFLOW_AUDIT_RETRY_BASE_MILLISECONDS: "25",
      CTLFLOW_AUDIT_RETRY_MAXIMUM_MILLISECONDS: "100",
      CTLFLOW_AUDIT_IDLE_MILLISECONDS: "10",
      CTLFLOW_CACHE_TTL_SECONDS: "30",
      CTLFLOW_WORKLOAD_TOKEN_ISSUER: kubernetes.issuer,
      CTLFLOW_WORKLOAD_TOKEN_AUDIENCE: kubernetes.audience,
      CTLFLOW_WORKLOAD_JWKS_PATH: kubernetes.jwksPath,
      CTLFLOW_WORKLOAD_TOKEN_MAX_LIFETIME_SECONDS: "600",
      CTLFLOW_INVOCATION_TOKEN_ISSUER: invocation.issuer,
      CTLFLOW_INVOCATION_TOKEN_AUDIENCE: invocation.audience,
      CTLFLOW_INVOCATION_JWKS_PATH: invocation.jwksPath,
      CTLFLOW_INVOCATION_TOKEN_MAX_LIFETIME_SECONDS: "60",
      CTLFLOW_RESOLVE_TENANT_CALLERS: kubernetes.callerSubject,
      CTLFLOW_RESOLVE_WORKSPACE_CALLERS: kubernetes.callerSubject,
      CTLFLOW_GET_LIFECYCLE_CALLERS: kubernetes.callerSubject,
      CTLFLOW_LIFECYCLE_IDENTITY_CALLER:
        lifecycleOwners.identity.callerSubject,
      CTLFLOW_LIFECYCLE_CONFIG_CALLER:
        lifecycleOwners.configuration.callerSubject,
      CTLFLOW_LIFECYCLE_EXEC_CALLER:
        lifecycleOwners.execution.callerSubject,
      CTLFLOW_LIFECYCLE_PACKAGE_CALLER:
        lifecycleOwners.packages.callerSubject,
      CTLFLOW_PAGE_CURSOR_TTL_SECONDS: "30",
      CTLFLOW_WATCH_MAX_LIFETIME_SECONDS: "1",
      OTEL_EXPORTER_OTLP_ENDPOINT: suite.collector.endpoint
    };
    service = await startCSharpService({
      publication: suite.publication,
      grpcHost: "127.0.0.1",
      grpcPort,
      probeHost: "127.0.0.1",
      probePort,
      environment
    });
    if (options.registerAggregatedApi ?? false) {
      await suite.kubernetes.registerAggregatedApi({
        group: "tenancy.ctlflow.com",
        version: "v1alpha1",
        serviceName: "tenantd-aggregation",
        serviceNamespace: "ctlflow-tests",
        hostPort: aggregationPort,
        serverCertificateAuthorityPath:
          suite.kubernetes.aggregation
            .serverCertificateAuthorityPath
      });
      await waitForTenancyApi(suite.kubernetes.api);
    }
    client = new TenantServiceClient(
      `127.0.0.1:${String(grpcPort)}`,
      credentials.createInsecure());

    let stopped = false;
    return {
      kubernetes,
      kubernetesApi: suite.kubernetes.api,
      aggregation: suite.kubernetes.aggregation,
      lifecycleOwners,
      collector: suite.collector,
      invocation,
      auditd,
      database,
      service,
      client,
      retainedTenants,
      activeWorkspace,
      grpcPort,
      probePort,
      aggregationPort,
      stop: async () => {
        if (stopped) {
          return;
        }

        stopped = true;
        client?.close();
        await suite.collector.resume();
        await stopContextResources(
          service,
          database,
          invocation,
          auditd);
      }
    };
  } catch (error) {
    client?.close();
    await suite.collector.resume().catch(() => undefined);
    await stopContextResources(service, database, invocation, auditd)
      .catch(() => undefined);
    throw error;
  }
}

async function setAuditOutboxCapacity(
  database: TestDatabase,
  capacity: number
): Promise<void> {
  if (!Number.isSafeInteger(capacity) || capacity < 1) {
    throw new Error("Audit outbox capacity must be a positive integer");
  }

  const updated = await database.connection("audit_outbox_state")
    .where({ state_id: 1 })
    .update({ maximum_pending: capacity });
  if (updated !== 1) {
    throw new Error("Audit outbox state is unavailable");
  }
}

async function waitForTenancyApi(
  api: TestKubernetesApiCredentials
): Promise<void> {
  const expiresAt = Date.now() + 10_000;
  let lastStatus = 0;
  let lastResponse = "";

  while (Date.now() < expiresAt) {
    const response = await requestTenancyApi(api, {
      method: "GET",
      path: "/apis/tenancy.ctlflow.com/v1alpha1"
    }).catch(() => undefined);
    lastStatus = response?.statusCode ?? 0;
    lastResponse = response?.text ?? "";
    if (lastStatus === 200) {
      return;
    }

    await delay(100);
  }

  const apiService = await requestTenancyApi(api, {
    method: "GET",
    path:
      "/apis/apiregistration.k8s.io/v1/apiservices/"
      + "v1alpha1.tenancy.ctlflow.com"
  }).catch(() => undefined);
  throw new Error(
    "Tenancy aggregated API did not become ready; "
    + `status ${lastStatus}; response ${lastResponse}; `
    + `APIService ${apiService?.text ?? "unavailable"}`);
}

async function seedResolutionRecords(
  database: TestDatabase
): Promise<void> {
  for (const [id, lifecycle, revision] of retainedTenants) {
    await insertTenant(database.connection, {
      id,
      lifecycle,
      revision
    });
  }
  await insertTenant(database.connection, {
    id: "tenant_shared",
    lifecycle: LifecycleState.LIFECYCLE_STATE_ACTIVE,
    revision: 17
  });
  await insertTenant(database.connection, {
    id: "tenant_retired_address",
    lifecycle: LifecycleState.LIFECYCLE_STATE_ACTIVE,
    revision: 18
  });

  await insertAddressBinding(database.connection, {
    id: "address_active_root",
    tenantId: "tenant_active",
    authority: "tenant.example.com",
    pathPrefix: "/",
    generation: 3
  });
  await insertAddressBinding(database.connection, {
    id: "address_active_shared",
    tenantId: "tenant_shared",
    authority: "shared.example.com",
    pathPrefix: "/tenants/atlas",
    generation: 4
  });
  await insertAddressBinding(database.connection, {
    id: "address_retired",
    tenantId: "tenant_retired_address",
    authority: "retired.example.com",
    pathPrefix: "/",
    active: false
  });
  await insertAddressBinding(database.connection, {
    id: "address_suspended",
    tenantId: "tenant_suspended",
    authority: "suspended.example.com",
    pathPrefix: "/"
  });

  await insertWorkspace(database.connection, {
    id: activeWorkspace.id,
    tenantId: activeWorkspace.tenantId,
    lifecycle: activeWorkspace.lifecycle,
    revision: activeWorkspace.revision
  });
  await insertWorkspace(database.connection, {
    id: "workspace_suspended",
    tenantId: "tenant_active",
    lifecycle: LifecycleState.LIFECYCLE_STATE_SUSPENDED,
    revision: 23
  });
  await insertWorkspace(database.connection, {
    id: "workspace_retired",
    tenantId: "tenant_active",
    lifecycle: LifecycleState.LIFECYCLE_STATE_ACTIVE,
    revision: 24
  });
  await insertWorkspace(database.connection, {
    id: "workspace_in_suspended_tenant",
    tenantId: "tenant_suspended",
    lifecycle: LifecycleState.LIFECYCLE_STATE_ACTIVE,
    revision: 25
  });

  await insertWorkspaceAddressBinding(database.connection, {
    id: "workspace_binding_alpha",
    tenantId: activeWorkspace.tenantId,
    workspaceId: activeWorkspace.id,
    workspaceAddress: activeWorkspace.address,
    generation: activeWorkspace.generation
  });
  await insertWorkspaceAddressBinding(database.connection, {
    id: "workspace_binding_beta",
    tenantId: "tenant_active",
    workspaceId: "workspace_suspended",
    workspaceAddress: "beta"
  });
  await insertWorkspaceAddressBinding(database.connection, {
    id: "workspace_binding_gamma",
    tenantId: "tenant_active",
    workspaceId: "workspace_retired",
    workspaceAddress: "gamma",
    active: false
  });
  await insertWorkspaceAddressBinding(database.connection, {
    id: "workspace_binding_delta",
    tenantId: "tenant_suspended",
    workspaceId: "workspace_in_suspended_tenant",
    workspaceAddress: "delta"
  });

  await insertTenant(database.connection, {
    id: "tenant_second",
    lifecycle: LifecycleState.LIFECYCLE_STATE_ACTIVE,
    revision: 19
  });
  await insertWorkspace(database.connection, {
    id: "workspace_second",
    tenantId: "tenant_second",
    lifecycle: LifecycleState.LIFECYCLE_STATE_ACTIVE,
    revision: 26
  });
}

async function stopContextResources(
  service: CSharpService | undefined,
  database: TestDatabase | undefined,
  invocation: InvocationAuthority | undefined,
  auditd: AuditdTestSource | undefined
): Promise<void> {
  let failure: unknown;

  for (const stop of [
    service?.stop,
    auditd?.stop,
    database?.stop,
    invocation?.stop
  ]) {
    if (stop === undefined) {
      continue;
    }

    try {
      await stop();
    } catch (error) {
      failure ??= error;
    }
  }

  if (failure !== undefined) {
    throw failure;
  }
}
