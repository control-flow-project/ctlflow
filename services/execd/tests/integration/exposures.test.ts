import assert from "node:assert/strict";
import { test } from "node:test";
import {
  findAvailablePort,
  stopProcess
} from "@ctlflow/test-mesh";
import type {
  AppScope
} from "../generated/v1/pkgd.js";
import type {
  CreateSessionResponse
} from "../generated/v1/identityd.js";
import {
  RealizationPhase,
  type DeclarePlacementRequest,
  type Placement,
  type Workload
} from "../generated/v1/execd.js";
import {
  getExecdTestContext
} from "../suite/get-execd-test-context.js";
import {
  getExecdTestSuite
} from "../suite/get-execd-test-suite.js";
import {
  callUnary
} from "../support/call-unary.js";
import {
  getPlacementNamespace
} from "../support/kubernetes/get-placement-namespace.js";
import {
  listOwnedKubernetesObjects
} from "../support/kubernetes/list-owned-kubernetes-objects.js";
import {
  declareTestApp
} from "../support/packages/declare-test-app.js";
import {
  createPlacementRequest
} from "../support/placements/create-placement-request.js";
import {
  waitFor
} from "../support/wait-for.js";
import {
  createWorkloadRequest
} from "../support/workloads/create-workload-request.js";
import {
  workloadMetadata
} from "../support/workload-metadata.js";

test("realizes tenant and workspace HTTP exposures through Edged sidecars",
  async () => {
    const global = await declarePlacement(createPlacementRequest({
      placementId: "exposure_global",
      target: { global: {} }
    }));
    const tenant = await declarePlacement(createPlacementRequest({
      placementId: "exposure_tenant",
      target: { tenant: { tenantId: "tenant-a" } },
      parentPlacementId: global.placementId
    }));
    const workspace = await declarePlacement(createPlacementRequest({
      placementId: "exposure_workspace",
      target: {
        workspace: {
          tenantId: "tenant-a",
          workspaceId: "workspace-a"
        }
      },
      parentPlacementId: tenant.placementId
    }));

    await assertExposure({
      placementId: tenant.placementId,
      appId: "exposure_tenant_app",
      workloadId: "exposure_tenant_workload",
      scope: { tenant: { tenantId: "tenant-a" } },
      target: { tenant_id: "tenant-a" }
    });
    await assertExposure({
      placementId: workspace.placementId,
      appId: "exposure_workspace_app",
      workloadId: "exposure_workspace_workload",
      scope: {
        workspace: {
          tenantId: "tenant-a",
          workspaceId: "workspace-a"
        }
      },
      target: {
        tenant_id: "tenant-a",
        workspace_id: "workspace-a"
      }
    });
  });

interface ExposureOptions {
  readonly placementId: string;
  readonly appId: string;
  readonly workloadId: string;
  readonly scope: AppScope;
  readonly target: Readonly<Record<string, string>>;
}

async function assertExposure(options: ExposureOptions): Promise<void> {
  const context = getExecdTestContext();
  await declareTestApp(context.pkgd.client, {
    appId: options.appId,
    placementId: options.placementId,
    scope: options.scope,
    artifact: getExecdTestSuite().applicationArtifact
  });
  const workload = await declareWorkload(createWorkloadRequest({
    workloadId: options.workloadId,
    placementId: options.placementId,
    appId: options.appId,
    componentId: "web",
    mode: "continuous",
    interfaceIds: ["http"]
  }));
  const ownership = {
    "execution.ctlflow.io/owner-service": "execd",
    "execution.ctlflow.io/workload-id": options.workloadId
  };
  try {
    await waitFor(
      async () => await getWorkload(workload.workloadId),
      (value) =>
        value.realization?.phase
          === RealizationPhase.REALIZATION_PHASE_READY,
      30_000);
  } catch (error) {
    throw new Error(
      `${String(error)}\n${await readExposureDiagnostics(
        options.placementId,
        ownership)}`,
      { cause: error });
  }

  const suite = getExecdTestSuite();
  const namespace = await getPlacementNamespace(
    suite.kubernetes,
    options.placementId);
  const deployments = await listOwnedKubernetesObjects(
    suite.kubernetes,
    "deployments",
    ownership,
    namespace);
  assert.equal(deployments.length, 1);
  const deployment = requireRecord(deployments[0]!.spec, "deployment spec");
  const template = requireRecord(deployment.template, "pod template");
  const pod = requireRecord(template.spec, "pod spec");
  const containers = requireRecords(pod.containers, "containers");
  assert.equal(containers.length, 2);
  const application = containers.find(
    (item) => item.name === "application");
  assert.ok(application !== undefined);
  assert.equal(
    hasNamedItem(application.volumeMounts, "edged-credentials-0"),
    false);
  const edged = containers.find((item) => item.name === "edged-0");
  assert.ok(edged !== undefined);
  const environment = requireRecords(edged.env, "Edged environment");
  assert.equal(
    environmentValue(environment, "CTLFLOW_PUBLIC_URL"),
    "http://0.0.0.0:10000");
  assert.equal(
    environmentValue(environment, "CTLFLOW_PROBE_URL"),
    "http://0.0.0.0:20000");
  assert.equal(
    environmentValue(environment, "CTLFLOW_IDENTITY_URL"),
    new URL(suite.identityd.endpoint).href);
  assert.equal(
    environmentValue(
      environment,
      "CTLFLOW_IDENTITY_TLS_SERVER_NAME"),
    suite.identityd.serverName);
  assert.equal(
    environmentValue(
      environment,
      "CTLFLOW_IDENTITY_TLS_CA_PATH"),
    "/var/run/ctlflow/edged/0/identityd-ca.crt");
  assert.equal(
    environmentValue(
      environment,
      "CTLFLOW_WORKLOAD_TOKEN_FILE"),
    "/var/run/ctlflow/edged/0/token");
  assert.equal(
    environmentValue(environment, "OTEL_EXPORTER_OTLP_ENDPOINT"),
    new URL(suite.collector.endpoint).href);
  assert.deepEqual(
    JSON.parse(environmentValue(environment, "CTLFLOW_EDGED_BINDING")),
    {
      schema_version: 1,
      target: options.target,
      upstream_port: 8_080
    });
  assert.equal(
    hasNamedItem(edged.volumeMounts, "edged-credentials-0"),
    true);

  const volumes = requireRecords(pod.volumes, "volumes");
  const credentialsVolume = volumes.find(
    (item) => item.name === "edged-credentials-0");
  assert.ok(credentialsVolume !== undefined);
  const projected = requireRecord(
    credentialsVolume.projected,
    "Edged projected volume");
  const sources = requireRecords(
    projected.sources,
    "Edged projected sources");
  const tokenSource = sources
    .map((item) => item.serviceAccountToken)
    .find((item) => item !== undefined);
  assert.deepEqual(tokenSource, {
    audience: "ctlflow-edged",
    expirationSeconds: 600,
    path: "token"
  });
  const configMapSource = sources
    .map((item) => item.configMap)
    .find((item) => item !== undefined);
  const configMapProjection = requireRecord(
    configMapSource,
    "Edged trust projection");
  assert.deepEqual(
    requireRecords(configMapProjection.items, "trust items"),
    [{
      key: "identityd-ca.crt",
      path: "identityd-ca.crt"
    }]);

  // One Edged trust ConfigMap and one product runtime trust ConfigMap.
  const configMaps = await listOwnedKubernetesObjects(
    suite.kubernetes,
    "configmaps",
    ownership,
    namespace);
  assert.equal(configMaps.length, 2);
  const edgedTrust = configMaps.find(
    (item) => item.metadata.name.startsWith("etr-"));
  const configMap = requireRecord(
    edgedTrust,
    "Edged trust ConfigMap");
  const configMapData = requireRecord(
    configMap.data,
    "Edged trust data");
  assert.deepEqual(Object.keys(configMapData), ["identityd-ca.crt"]);
  assert.match(
    requireString(
      configMapData["identityd-ca.crt"],
      "Identityd certificate authority"),
    /-----BEGIN CERTIFICATE-----/u);
  const workloadTrust = configMaps.find(
    (item) => item.metadata.name.startsWith("wtr-"));
  const workloadTrustData = requireRecord(
    requireRecord(workloadTrust, "workload trust ConfigMap").data,
    "workload trust data");
  assert.deepEqual(
    Object.keys(workloadTrustData).sort(),
    ["identityd-ca.crt", "policyd-ca.crt", "workload-jwks.json"]);

  const services = await listOwnedKubernetesObjects(
    suite.kubernetes,
    "services",
    ownership,
    namespace);
  assert.equal(services.length, 1);
  const service = requireRecord(services[0]!.spec, "service spec");
  const ports = requireRecords(service.ports, "service ports");
  assert.equal(ports.length, 1);
  assert.equal(ports[0]!.port, 8_080);
  assert.equal(ports[0]!.targetPort, 10_000);

  const serviceMetadata = requireRecord(
    services[0]!.metadata,
    "service metadata");
  const serviceName = requireString(
    serviceMetadata.name,
    "service name");
  const response = await requestExposedApplication(
    namespace,
    serviceName,
    await createSessionCredential());
  assert.equal(response.status, 200);
  const evidence = requireRecord(
    JSON.parse(response.body) as unknown,
    "application evidence");
  assert.equal(evidence.method, "POST");
  assert.equal(evidence.target, "/hello?source=execd");
  assert.equal(evidence.cookie, undefined);
  assert.equal(evidence.body, "through-edged");
  assert.equal(evidence.edgedCredentialsMounted, false);
  const authorization = requireString(
    evidence.authorization,
    "application authorization");
  assert.match(authorization, /^Bearer [^.]+\.[^.]+\.[^.]+$/u);
  const claims = readJwtClaims(authorization.slice("Bearer ".length));
  assert.equal(claims.tenant_id, options.target.tenant_id);
  assert.equal(
    claims.workspace_id,
    options.target.workspace_id);
}

async function createSessionCredential(): Promise<string> {
  const suite = getExecdTestSuite();
  const session = await callUnary<CreateSessionResponse>((done) =>
    suite.identityClient.createSession(
      {
        tenantId: "tenant-a",
        providerId: "oidc",
        providerSubject: "alice@example.com"
      },
      workloadMetadata(suite.authdWorkload.callerToken),
      done));
  return Buffer.from(session.sessionCredential).toString("base64url");
}

async function requestExposedApplication(
  namespace: string,
  serviceName: string,
  sessionCredential: string
): Promise<{
  readonly status: number;
  readonly body: string;
}> {
  const suite = getExecdTestSuite();
  await waitForServiceEndpoint(namespace, serviceName);
  const port = await findAvailablePort();
  const forwarding = suite.kubernetes.startKubectl([
    "--namespace",
    namespace,
    "port-forward",
    `service/${serviceName}`,
    `${String(port)}:8080`
  ]);
  try {
    try {
      return await waitFor(
        async () => {
          try {
            const response = await fetch(
              `http://127.0.0.1:${String(port)}/hello?source=execd`,
              {
                method: "POST",
                headers: {
                  cookie:
                    `__Host-ctlflow-session=${sessionCredential}`
                },
                body: "through-edged",
                signal: AbortSignal.timeout(2_000)
              });
            return {
              status: response.status,
              body: await response.text()
            };
          } catch {
            return undefined;
          }
        },
        (value) => value?.status === 200,
        15_000) as {
          readonly status: number;
          readonly body: string;
        };
    } catch (error) {
      throw new Error(
        `${String(error)}\n${forwarding.diagnostics()}`,
        { cause: error });
    }
  } finally {
    await stopProcess(forwarding);
  }
}

async function waitForServiceEndpoint(
  namespace: string,
  serviceName: string
): Promise<void> {
  const suite = getExecdTestSuite();
  await waitFor(
    async () => JSON.parse((await suite.kubernetes.runKubectl([
      "get",
      `endpoints/${serviceName}`,
      "--namespace",
      namespace,
      "--output=json"
    ])).stdout) as unknown,
    hasReadyEndpoint,
    15_000);
}

function hasReadyEndpoint(value: unknown): boolean {
  if (typeof value !== "object"
      || value === null
      || Array.isArray(value)) {
    return false;
  }
  const subsets = (value as Readonly<Record<string, unknown>>).subsets;
  return Array.isArray(subsets)
    && subsets.some((subset) => {
      if (typeof subset !== "object"
          || subset === null
          || Array.isArray(subset)) {
        return false;
      }
      const addresses =
        (subset as Readonly<Record<string, unknown>>).addresses;
      return Array.isArray(addresses) && addresses.length > 0;
    });
}

async function readExposureDiagnostics(
  placementId: string,
  ownership: Readonly<Record<string, string>>
): Promise<string> {
  const suite = getExecdTestSuite();
  const namespace = await getPlacementNamespace(
    suite.kubernetes,
    placementId).catch((error: unknown) => error);
  if (typeof namespace !== "string") {
    return `Placement namespace is unavailable: ${String(namespace)}`;
  }
  const deployments = await listOwnedKubernetesObjects(
    suite.kubernetes,
    "deployments",
    ownership,
    namespace);
  const deployment = deployments[0];
  const metadata = deployment === undefined
    ? undefined
    : requireRecord(deployment.metadata, "deployment metadata");
  const name = metadata === undefined
    ? undefined
    : requireString(metadata.name, "deployment name");
  if (name === undefined) {
    return "No owned Kubernetes Deployment was found";
  }

  const description = await suite.kubernetes.runKubectl([
    "describe",
    `deployment/${name}`,
    "--namespace",
    namespace
  ]).then((result) => result.stdout.trim())
    .catch((error: unknown) => String(error));
  const logs = await suite.kubernetes.runKubectl([
    "logs",
    `deployment/${name}`,
    "--namespace",
    namespace,
    "--all-containers=true",
    "--prefix=true",
    "--tail=100"
  ]).then((result) => result.stdout.trim())
    .catch((error: unknown) => String(error));
  return `${description}\n${logs}`;
}

function readJwtClaims(
  token: string
): Readonly<Record<string, unknown>> {
  const segments = token.split(".");
  if (segments.length !== 3) {
    throw new Error("application authorization is not a JWT");
  }
  return requireRecord(
    JSON.parse(
      Buffer.from(segments[1]!, "base64url").toString("utf8")
    ) as unknown,
    "invocation claims");
}

async function declarePlacement(
  request: DeclarePlacementRequest
): Promise<Placement> {
  const context = getExecdTestContext();
  return await callUnary((done) =>
    context.client.declarePlacement(request, done));
}

async function declareWorkload(
  request: ReturnType<typeof createWorkloadRequest>
): Promise<Workload> {
  const context = getExecdTestContext();
  return await callUnary((done) =>
    context.client.declareWorkload(request, done));
}

async function getWorkload(workloadId: string): Promise<Workload> {
  const context = getExecdTestContext();
  return await callUnary((done) =>
    context.client.getWorkload({ workloadId }, done));
}

function environmentValue(
  environment: readonly Readonly<Record<string, unknown>>[],
  name: string
): string {
  const entry = environment.find((item) => item.name === name);
  assert.ok(entry !== undefined);
  if (typeof entry.value !== "string") {
    throw new Error(`${name} is not a string`);
  }
  return entry.value;
}

function hasNamedItem(value: unknown, name: string): boolean {
  if (value === undefined) {
    return false;
  }
  return requireRecords(value, "named items")
    .some((item) => item.name === name);
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string") {
    throw new Error(`${name} is not a string`);
  }
  return value;
}

function requireRecords(
  value: unknown,
  name: string
): readonly Readonly<Record<string, unknown>>[] {
  if (!Array.isArray(value)) {
    throw new Error(`${name} is not an array`);
  }
  return value.map((item) => requireRecord(item, name));
}

function requireRecord(
  value: unknown,
  name: string
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object"
      || value === null
      || Array.isArray(value)) {
    throw new Error(`${name} is not an object`);
  }
  return value as Readonly<Record<string, unknown>>;
}
