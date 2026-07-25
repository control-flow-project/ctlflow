import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import {
  Server,
  ServerCredentials
} from "@grpc/grpc-js";
import {
  AuditServiceService,
  type AuditServiceServer
} from "../../generated/v1/auditd.js";
import { createRecordAuditBatch } from "./record-audit-batch.js";
import { handleAuditdControl } from "./handle-auditd-control.js";

const grpcPort = readPort("CTLFLOW_TEST_AUDIT_GRPC_PORT");
const controlPort = readPort("CTLFLOW_TEST_AUDIT_CONTROL_PORT");
const databasePath = requireEnvironment(
  "CTLFLOW_TEST_AUDIT_DATABASE_PATH");
const database = new DatabaseSync(databasePath);
database.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;
  CREATE TABLE sources (
    source_id TEXT PRIMARY KEY,
    token TEXT NOT NULL UNIQUE,
    mode TEXT NOT NULL,
    next_cursor INTEGER NOT NULL
  );
  CREATE TABLE events (
    source_id TEXT NOT NULL,
    source_event_id TEXT NOT NULL,
    source_sequence INTEGER NOT NULL,
    fingerprint TEXT NOT NULL,
    evidence_json TEXT NOT NULL,
    partition_cursor INTEGER NOT NULL,
    PRIMARY KEY (source_id, source_event_id),
    UNIQUE (source_id, source_sequence),
    UNIQUE (source_id, partition_cursor),
    FOREIGN KEY (source_id) REFERENCES sources(source_id)
      ON DELETE CASCADE
  );
`);

const grpcServer = new Server({
  "grpc.max_receive_message_length": 64 * 1024,
  "grpc.max_send_message_length": 64 * 1024
});
const implementation: AuditServiceServer = {
  recordAuditBatch: createRecordAuditBatch(database)
};
grpcServer.addService(AuditServiceService, implementation);
await new Promise<void>((resolve, reject) => {
  grpcServer.bindAsync(
    `127.0.0.1:${String(grpcPort)}`,
    ServerCredentials.createInsecure(),
    (error) => {
      if (error === null) {
        resolve();
      } else {
        reject(error);
      }
    });
});

const controlServer = createServer((request, response) => {
  void handleAuditdControl(
    database,
    request,
    response);
});
await new Promise<void>((resolve, reject) => {
  controlServer.once("error", reject);
  controlServer.listen(controlPort, "127.0.0.1", () => resolve());
});

let stopping = false;
const stop = (): void => {
  if (stopping) {
    return;
  }
  stopping = true;
  controlServer.closeAllConnections();
  controlServer.close();
  grpcServer.forceShutdown();
  database.close();
  process.exit(0);
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);

function readPort(name: string): number {
  const value = Number(requireEnvironment(name));
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error(`${name} must be a valid port`);
  }
  return value;
}

function requireEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}
