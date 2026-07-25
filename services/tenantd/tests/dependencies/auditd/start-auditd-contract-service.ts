import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  findAvailablePort,
  startProcess,
  stopProcess,
  waitForReadiness,
  type ManagedProcess
} from "@ctlflow/test-mesh";
import type {
  AuditdContractService
} from "./auditd-contract-service.js";
import type {
  AuditEventEvidence
} from "./audit-event-evidence.js";
import type { AuditdMode } from "./auditd-mode.js";
import type {
  AuditdTestSource
} from "./auditd-test-source.js";
import { requestAuditdControl } from "./request-auditd-control.js";

export async function startAuditdContractService(
  repositoryRoot: string,
  serviceRoot: string
): Promise<AuditdContractService> {
  const grpcPort = await findAvailablePort();
  let controlPort = await findAvailablePort();
  while (controlPort === grpcPort) {
    controlPort = await findAvailablePort();
  }

  const instanceId = randomUUID();
  const directory = path.join(
    repositoryRoot,
    ".temp/tests/auditd",
    instanceId);
  await mkdir(directory, { recursive: true });
  const controlEndpoint =
    `http://127.0.0.1:${String(controlPort)}`;
  let process_: ManagedProcess | undefined;
  try {
    process_ = startProcess(
      process.execPath,
      [
        path.join(
          serviceRoot,
          "tests/dist/dependencies/auditd/"
            + "run-auditd-contract-service.js")
      ],
      {
        cwd: repositoryRoot,
        environment: {
          CTLFLOW_TEST_AUDIT_GRPC_PORT: String(grpcPort),
          CTLFLOW_TEST_AUDIT_CONTROL_PORT: String(controlPort),
          CTLFLOW_TEST_AUDIT_DATABASE_PATH:
            path.join(directory, "auditd.sqlite")
        }
      });
    await waitForReadiness("127.0.0.1", controlPort, process_);
    let stopped = false;
    return {
      endpoint: `http://127.0.0.1:${String(grpcPort)}`,
      createSource: () => createSource(
        controlEndpoint,
        directory),
      stop: async () => {
        if (stopped) {
          return;
        }

        stopped = true;
        await stopProcess(process_!);
      }
    };
  } catch (error) {
    if (process_ !== undefined) {
      await stopProcess(process_).catch(() => undefined);
    }
    throw error;
  }
}

async function createSource(
  controlEndpoint: string,
  directory: string
): Promise<AuditdTestSource> {
  const sourceId = `source_${randomUUID().replaceAll("-", "")}`;
  const token = randomBytes(32).toString("base64url");
  const sourceDirectory = path.join(directory, sourceId);
  const tokenFile = path.join(sourceDirectory, "token");
  await mkdir(sourceDirectory, { recursive: true });
  await writeFile(tokenFile, token, { mode: 0o600 });
  await requestAuditdControl<void>(
    controlEndpoint,
    "/sources",
    {
      method: "POST",
      body: { sourceId, token }
    });

  let stopped = false;
  return {
    sourceId,
    tokenFile,
    setMode: async (mode: AuditdMode) => {
      await requestAuditdControl<void>(
        controlEndpoint,
        `/sources/${sourceId}/mode`,
        {
          method: "PUT",
          body: { mode }
        });
    },
    readEvents: async () =>
      await requestAuditdControl<AuditEventEvidence[]>(
        controlEndpoint,
        `/sources/${sourceId}/events`),
    replaceToken: async (replacement: string) => {
      await writeFile(tokenFile, replacement, { mode: 0o600 });
    },
    restoreToken: async () => {
      await writeFile(tokenFile, token, { mode: 0o600 });
    },
    stop: async () => {
      if (stopped) {
        return;
      }

      stopped = true;
      await requestAuditdControl<void>(
        controlEndpoint,
        `/sources/${sourceId}`,
        { method: "DELETE" });
    }
  };
}
