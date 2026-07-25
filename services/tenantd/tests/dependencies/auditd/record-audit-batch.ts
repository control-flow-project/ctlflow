import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  status,
  type handleUnaryCall
} from "@grpc/grpc-js";
import {
  AuditEvent,
  type AuditAcceptance,
  type RecordAuditBatchRequest,
  type RecordAuditBatchResponse
} from "../../generated/v1/auditd.js";
import { createAuditEventEvidence } from "./create-audit-event-evidence.js";
import { createServiceError } from "./create-service-error.js";
import { validateAuditEvent } from "./validate-audit-event.js";

interface SourceRow {
  readonly source_id: string;
  readonly mode: string;
  readonly next_cursor: number;
}

interface ExistingEventRow {
  readonly fingerprint: string;
  readonly partition_cursor: number;
}

export function createRecordAuditBatch(
  database: DatabaseSync
): handleUnaryCall<
RecordAuditBatchRequest,
RecordAuditBatchResponse> {
  return (call, callback) => {
    const authorization = call.metadata.get("authorization");
    if (
      authorization.length !== 1
      || typeof authorization[0] !== "string"
      || !authorization[0].startsWith("Bearer ")
    ) {
      callback(createServiceError(
        status.UNAUTHENTICATED,
        "Authentication failed"));
      return;
    }

    const token = authorization[0].slice("Bearer ".length);
    const source = database.prepare(`
      SELECT source_id, mode, next_cursor
      FROM sources
      WHERE token = ?
    `).get(token) as SourceRow | undefined;
    if (source === undefined) {
      callback(createServiceError(
        status.UNAUTHENTICATED,
        "Authentication failed"));
      return;
    }
    if (source.mode === "unavailable") {
      callback(createServiceError(
        status.UNAVAILABLE,
        "Audit persistence is unavailable"));
      return;
    }
    if (source.mode === "resource-exhausted") {
      callback(createServiceError(
        status.RESOURCE_EXHAUSTED,
        "Audit ingestion capacity is exhausted"));
      return;
    }
    if (source.mode === "stall") {
      call.once("cancelled", () => undefined);
      return;
    }
    if (source.mode === "conflicting-replay") {
      callback(createServiceError(
        status.ALREADY_EXISTS,
        "Source event ID is bound to another envelope"));
      return;
    }
    if (source.mode === "invalid-envelope") {
      callback(createServiceError(
        status.INVALID_ARGUMENT,
        "Audit envelope is rejected"));
      return;
    }
    if (source.mode === "permission-denied") {
      callback(createServiceError(
        status.PERMISSION_DENIED,
        "Audit source is not admitted"));
      return;
    }
    if (source.mode === "invalid-acceptance") {
      callback(null, { acceptances: [] });
      return;
    }

    const invalid = validateRequest(call.request);
    if (invalid !== undefined) {
      callback(createServiceError(status.INVALID_ARGUMENT, invalid));
      return;
    }

    try {
      const response = persistBatch(
        database,
        source,
        call.request);
      if (source.mode === "accept-then-drop") {
        database.prepare(`
          UPDATE sources SET mode = 'normal' WHERE source_id = ?
        `).run(source.source_id);
        callback(createServiceError(
          status.UNAVAILABLE,
          "Response was interrupted after acceptance"));
        return;
      }

      callback(null, response);
    } catch (error) {
      callback(
        error instanceof AuditConflict
          ? createServiceError(status.ALREADY_EXISTS, error.message)
          : createServiceError(
              status.UNAVAILABLE,
              "Audit persistence failed"));
    }
  };
}

function validateRequest(
  request: RecordAuditBatchRequest
): string | undefined {
  if (request.sourceSchemaGeneration !== 1n) {
    return "source schema generation is unsupported";
  }
  if (request.events.length < 1 || request.events.length > 100) {
    return "batch size is invalid";
  }

  const eventIds = new Set<string>();
  let priorSequence = 0n;
  for (const event of request.events) {
    const invalid = validateAuditEvent(event);
    if (invalid !== undefined) {
      return invalid;
    }
    if (eventIds.has(event.sourceEventId)) {
      return "source event IDs must be unique within a batch";
    }
    if (event.sourceSequence <= priorSequence) {
      return "source sequences must be strictly increasing";
    }
    eventIds.add(event.sourceEventId);
    priorSequence = event.sourceSequence;
  }

  return undefined;
}

function persistBatch(
  database: DatabaseSync,
  source: SourceRow,
  request: RecordAuditBatchRequest
): RecordAuditBatchResponse {
  database.exec("BEGIN IMMEDIATE");
  try {
    let cursor = source.next_cursor;
    const acceptances: AuditAcceptance[] = [];
    const maximum = database.prepare(`
      SELECT COALESCE(MAX(source_sequence), 0) AS value
      FROM events
      WHERE source_id = ?
    `).get(source.source_id) as { readonly value: number };
    let maximumSequence = maximum.value;

    for (const event of request.events) {
      const fingerprint = createHash("sha256")
        .update(AuditEvent.encode(event).finish())
        .digest("hex");
      const existing = database.prepare(`
        SELECT fingerprint, partition_cursor
        FROM events
        WHERE source_id = ? AND source_event_id = ?
      `).get(
        source.source_id,
        event.sourceEventId
      ) as ExistingEventRow | undefined;
      if (existing !== undefined) {
        if (existing.fingerprint !== fingerprint) {
          throw new AuditConflict(
            "Source event ID is bound to another envelope");
        }
        acceptances.push({
          sourceEventId: event.sourceEventId,
          partitionCursor: BigInt(existing.partition_cursor)
        });
        continue;
      }

      const sequence = Number(event.sourceSequence);
      if (sequence <= maximumSequence) {
        throw new AuditConflict(
          "Source sequence is bound to another event");
      }
      cursor++;
      const evidence = createAuditEventEvidence(event, cursor);
      database.prepare(`
        INSERT INTO events (
          source_id,
          source_event_id,
          source_sequence,
          fingerprint,
          evidence_json,
          partition_cursor
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        source.source_id,
        event.sourceEventId,
        sequence,
        fingerprint,
        JSON.stringify(evidence),
        cursor);
      maximumSequence = sequence;
      acceptances.push({
        sourceEventId: event.sourceEventId,
        partitionCursor: BigInt(cursor)
      });
    }
    database.prepare(`
      UPDATE sources SET next_cursor = ? WHERE source_id = ?
    `).run(cursor, source.source_id);
    database.exec("COMMIT");
    return { acceptances };
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

class AuditConflict extends Error {
}
