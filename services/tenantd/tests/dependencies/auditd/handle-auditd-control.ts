import type {
  IncomingMessage,
  ServerResponse
} from "node:http";
import type { DatabaseSync } from "node:sqlite";
import type {
  AuditEventEvidence
} from "./audit-event-evidence.js";
import type { AuditdMode } from "./auditd-mode.js";
import { readJsonBody } from "./read-json-body.js";
import { writeJsonResponse } from "./write-json-response.js";

const sourcePath =
  /^\/sources\/([a-z0-9][a-z0-9_-]{0,63})(?:\/(mode|events))?$/u;
const admittedModes = new Set<AuditdMode>([
  "normal",
  "unavailable",
  "resource-exhausted",
  "stall",
  "accept-then-drop",
  "conflicting-replay",
  "invalid-envelope",
  "invalid-acceptance",
  "permission-denied"
]);

export async function handleAuditdControl(
  database: DatabaseSync,
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  try {
    if (request.method === "GET" && request.url === "/readyz") {
      writeJsonResponse(response, 204);
      return;
    }
    if (request.method === "POST" && request.url === "/sources") {
      await createSource(database, request);
      writeJsonResponse(response, 204);
      return;
    }

    const match = sourcePath.exec(request.url ?? "");
    if (match === null) {
      writeJsonResponse(response, 404, { error: "not_found" });
      return;
    }
    const sourceId = match[1]!;
    const operation = match[2];
    if (
      request.method === "PUT"
      && operation === "mode"
    ) {
      await setMode(database, sourceId, request);
      writeJsonResponse(response, 204);
      return;
    }
    if (
      request.method === "GET"
      && operation === "events"
    ) {
      writeJsonResponse(response, 200, readEvents(database, sourceId));
      return;
    }
    if (
      request.method === "DELETE"
      && operation === undefined
    ) {
      database.prepare(
        "DELETE FROM sources WHERE source_id = ?"
      ).run(sourceId);
      writeJsonResponse(response, 204);
      return;
    }

    writeJsonResponse(response, 405, { error: "method_not_allowed" });
  } catch {
    writeJsonResponse(response, 400, { error: "invalid_request" });
  }
}

async function createSource(
  database: DatabaseSync,
  request: IncomingMessage
): Promise<void> {
  const body = await readJsonBody(request);
  if (
    !isObject(body)
    || typeof body.sourceId !== "string"
    || !/^[a-z0-9][a-z0-9_-]{0,63}$/u.test(body.sourceId)
    || typeof body.token !== "string"
    || body.token.length < 16
    || body.token.length > 4096
    || /\s/u.test(body.token)
  ) {
    throw new Error("Source registration is invalid");
  }
  database.prepare(`
    INSERT INTO sources (
      source_id,
      token,
      mode,
      next_cursor
    ) VALUES (?, ?, 'normal', 0)
  `).run(body.sourceId, body.token);
}

async function setMode(
  database: DatabaseSync,
  sourceId: string,
  request: IncomingMessage
): Promise<void> {
  const body = await readJsonBody(request);
  if (
    !isObject(body)
    || typeof body.mode !== "string"
    || !admittedModes.has(body.mode as AuditdMode)
  ) {
    throw new Error("Audit mode is invalid");
  }
  const result = database.prepare(`
    UPDATE sources SET mode = ? WHERE source_id = ?
  `).run(body.mode, sourceId);
  if (result.changes !== 1) {
    throw new Error("Audit source is absent");
  }
}

function readEvents(
  database: DatabaseSync,
  sourceId: string
): readonly AuditEventEvidence[] {
  const rows = database.prepare(`
    SELECT evidence_json
    FROM events
    WHERE source_id = ?
    ORDER BY source_sequence
  `).all(sourceId) as unknown as readonly {
    readonly evidence_json: string;
  }[];
  return rows.map((row) =>
    JSON.parse(row.evidence_json) as AuditEventEvidence);
}

function isObject(
  value: unknown
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
