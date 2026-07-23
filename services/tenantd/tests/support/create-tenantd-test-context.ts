import { credentials } from "@grpc/grpc-js";
import {
  findAvailablePort,
  startCSharpService,
  startOpenTelemetryCollector,
  startTestKubernetes,
  type CSharpService,
  type OpenTelemetryCollector,
  type TestKubernetes
} from "@ctlflow/test-mesh";
import {
  TenantLifecycle,
  TenantServiceClient
} from "../generated/v1/tenantd.js";
import { createInvocationAuthority } from "./create-invocation-authority.js";
import { createTestDatabase } from "./create-test-database.js";
import { insertAddressBinding } from "./insert-address-binding.js";
import { insertTenant } from "./insert-tenant.js";
import type { InvocationAuthority } from "./invocation-authority.js";
import type { TestDatabase } from "./test-database.js";
import {
  diagnosticsManifestPath,
  repositoryRoot,
  serviceProjectPath
} from "./test-paths.js";

export type RetainedTenant = readonly [
  id: string,
  lifecycle: TenantLifecycle,
  revision: number
];

export interface TenantdTestContext {
  readonly kubernetes: TestKubernetes;
  readonly collector: OpenTelemetryCollector;
  readonly invocation: InvocationAuthority;
  readonly database: TestDatabase;
  readonly service: CSharpService;
  readonly client: TenantServiceClient;
  readonly retainedTenants: readonly RetainedTenant[];
  readonly grpcPort: number;
  readonly probePort: number;
  readonly stop: () => Promise<void>;
}

const retainedTenants: readonly RetainedTenant[] = [
  ["tenant_provisioning", TenantLifecycle.TENANT_LIFECYCLE_PROVISIONING, 11],
  ["tenant_active", TenantLifecycle.TENANT_LIFECYCLE_ACTIVE, 12],
  ["tenant_suspended", TenantLifecycle.TENANT_LIFECYCLE_SUSPENDED, 13],
  ["tenant_deleting", TenantLifecycle.TENANT_LIFECYCLE_DELETING, 14],
  ["tenant_failed", TenantLifecycle.TENANT_LIFECYCLE_FAILED, 15],
  ["tenant_deleted", TenantLifecycle.TENANT_LIFECYCLE_DELETED, 16]
];

export async function createTenantdTestContext():
Promise<TenantdTestContext> {
  let kubernetes: TestKubernetes | undefined;
  let collector: OpenTelemetryCollector | undefined;
  let invocation: InvocationAuthority | undefined;
  let database: TestDatabase | undefined;
  let service: CSharpService | undefined;
  let client: TenantServiceClient | undefined;

  try {
    kubernetes = await startTestKubernetes(repositoryRoot);
    collector = await startOpenTelemetryCollector(repositoryRoot);
    invocation = await createInvocationAuthority();
    database = await createTestDatabase();

    for (const [id, lifecycle, revision] of retainedTenants) {
      await insertTenant(database.connection, {
        id,
        lifecycle,
        revision
      });
    }

    await insertAddressBinding(database.connection, {
      id: "address_active_root",
      tenantId: "tenant_active",
      authority: "tenant.example.com",
      pathPrefix: "/",
      generation: 3
    });
    await insertAddressBinding(database.connection, {
      id: "address_active_shared",
      tenantId: "tenant_active",
      authority: "shared.example.com",
      pathPrefix: "/tenants/atlas",
      generation: 4
    });
    await insertAddressBinding(database.connection, {
      id: "address_retired",
      tenantId: "tenant_active",
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

    const grpcPort = await findAvailablePort();
    let probePort = await findAvailablePort();
    while (probePort === grpcPort) {
      probePort = await findAvailablePort();
    }

    const environment = {
      CTLFLOW_GRPC_URL: `http://127.0.0.1:${String(grpcPort)}`,
      CTLFLOW_PROBE_URL: `http://127.0.0.1:${String(probePort)}`,
      CTLFLOW_DATABASE_PATH: database.path,
      CTLFLOW_DATABASE_POOL_SIZE: "4",
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
      OTEL_EXPORTER_OTLP_ENDPOINT: collector.endpoint
    };
    service = await startCSharpService({
      repositoryRoot,
      projectPath: serviceProjectPath,
      diagnosticsManifestPath,
      executableName: "CtlFlow.Tenancy.Tenantd.Service",
      grpcHost: "127.0.0.1",
      grpcPort,
      probeHost: "127.0.0.1",
      probePort,
      environment
    });
    client = new TenantServiceClient(
      `127.0.0.1:${String(grpcPort)}`,
      credentials.createInsecure());

    let stopped = false;
    return {
      kubernetes,
      collector,
      invocation,
      database,
      service,
      client,
      retainedTenants,
      grpcPort,
      probePort,
      stop: async () => {
        if (stopped) {
          return;
        }

        stopped = true;
        client?.close();
        await service?.stop();
        await database?.stop();
        await invocation?.stop();
        await collector?.stop();
        await kubernetes?.stop();
      }
    };
  } catch (error) {
    client?.close();
    await service?.stop();
    await database?.stop();
    await invocation?.stop();
    await collector?.stop();
    await kubernetes?.stop();
    throw error;
  }
}
