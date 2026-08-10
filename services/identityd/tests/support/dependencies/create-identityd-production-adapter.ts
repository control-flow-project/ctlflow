import type {
  TestKubernetes
} from "@ctlflow/test-mesh";
import {
  corruptPrincipalKind,
  expireSession,
  replaceExternalIdentityLinks,
  replacePrincipalFacts,
  replaceWorkspaceLoginProviderAdmissions,
  replaceVerificationKeys,
  upsertLoginProviders,
  type IdentitydMode,
  type IdentitydProductionService
} from "@ctlflow/identityd/testing/production";
import type {
  IdentitydRunningService
} from "../../runtime/identityd-test-runtime.js";
import type {
  TestDatabase
} from "../test-database.js";

export interface CreateIdentitydProductionAdapterOptions {
  readonly kubernetes: TestKubernetes;
  readonly database: TestDatabase;
  readonly service: IdentitydRunningService;
  readonly environment: Readonly<Record<string, string>>;
  readonly certificateAuthorityPath: string;
  readonly serverName: string;
}

export function createIdentitydProductionAdapter(
  options: CreateIdentitydProductionAdapterOptions
): IdentitydProductionService {
  const modes = new Map<string, IdentitydMode>();
  let suspended = false;

  return {
    endpoint:
      `https://identityd.${options.kubernetes.namespace}.svc:50051`,
    grpcPort: options.service.grpcPort,
    certificateAuthorityPath: options.certificateAuthorityPath,
    serverName: options.serverName,
    createSource: async (configuration) => {
      modes.set(configuration.callerSubject, "available");
      await replaceVerificationKeys(
        options.database.connection,
        configuration.verificationKeys);
      if (configuration.principalFacts !== undefined) {
        await replacePrincipalFacts(
          options.database.connection,
          configuration.principalFacts);
      }
      if (configuration.loginProviders !== undefined) {
        await upsertLoginProviders(
          options.database.connection,
          configuration.loginProviders);
      }
      if (configuration.workspaceLoginProviderAdmissions !== undefined) {
        await replaceWorkspaceLoginProviderAdmissions(
          options.database.connection,
          configuration.workspaceLoginProviderAdmissions);
      }
      if (configuration.externalIdentityLinks !== undefined) {
        await replaceExternalIdentityLinks(
          options.database.connection,
          configuration.externalIdentityLinks);
      }

      return {
        corruptPrincipalKind: (principalId, kind) =>
          corruptPrincipalKind(
            options.database.connection,
            principalId,
            kind),
        expireSession: (credential) =>
          expireSession(options.database.connection, credential),
        setMode: async (mode) => {
          modes.set(configuration.callerSubject, mode);
          suspended = await applyModes(options, modes, suspended);
        },
        setVerificationKeys: (response) =>
          replaceVerificationKeys(options.database.connection, response),
        setPrincipalFacts: (facts) =>
          replacePrincipalFacts(options.database.connection, facts),
        setLoginProviders: (providers) =>
          upsertLoginProviders(options.database.connection, providers),
        setWorkspaceLoginProviderAdmissions: (admissions) =>
          replaceWorkspaceLoginProviderAdmissions(
            options.database.connection,
            admissions),
        stop: async () => {
          modes.delete(configuration.callerSubject);
          suspended = await applyModes(options, modes, suspended);
        }
      };
    },
    stop: async () => undefined
  };
}

async function applyModes(
  options: CreateIdentitydProductionAdapterOptions,
  modes: ReadonlyMap<string, IdentitydMode>,
  suspended: boolean
): Promise<boolean> {
  const unavailable = [...modes.values()]
    .some((mode) => mode === "unavailable");
  if (unavailable) {
    if (!suspended) {
      await scaleIdentityd(options.kubernetes, 0);
    }
    return true;
  }

  if (suspended) {
    await scaleIdentityd(options.kubernetes, 1);
    await options.service.reconnect();
  }

  const denied = [...modes.entries()]
    .filter(([, mode]) => mode === "denied")
    .map(([caller]) => caller);
  if (denied.length === 0) {
    if (!suspended) {
      await options.service.restart(options.environment);
    }
    return false;
  }

  const admitted = options.environment.CTLFLOW_RESOLVE_PRINCIPAL_CALLERS
    ?.split(",")
    .filter((caller) => !denied.includes(caller))
    ?? [];
  const callers = admitted.length > 0
    ? admitted.join(",")
    : `system:serviceaccount:${options.kubernetes.namespace}:unadmitted`;
  await options.service.restart({
    ...options.environment,
    CTLFLOW_RESOLVE_PRINCIPAL_CALLERS: callers,
    CTLFLOW_LIST_PRINCIPAL_GROUPS_CALLERS: callers
  });
  return false;
}

async function scaleIdentityd(
  kubernetes: TestKubernetes,
  replicas: 0 | 1
): Promise<void> {
  await kubernetes.runKubectl([
    "scale",
    "statefulset/identityd",
    "--namespace",
    kubernetes.namespace,
    `--replicas=${String(replicas)}`
  ]);
  if (replicas === 0) {
    await kubernetes.runKubectl([
      "wait",
      "--for=delete",
      "pod/identityd-0",
      "--namespace",
      kubernetes.namespace,
      "--timeout=30s"
    ]);
    return;
  }

  await kubernetes.runKubectl([
    "rollout",
    "status",
    "statefulset/identityd",
    "--namespace",
    kubernetes.namespace,
    "--timeout=30s"
  ]);
}
