export interface ExpectedOperationLog {
  readonly operation?: string;
  readonly outcome?: string;
  readonly traceId?: string;
}

interface OtlpAttribute {
  readonly key?: unknown;
  readonly value?: {
    readonly stringValue?: unknown;
  };
}

interface OtlpLogRecord {
  readonly attributes?: unknown;
  readonly eventName?: unknown;
  readonly traceId?: unknown;
}

export function hasOperationLog(
  content: string,
  expected: ExpectedOperationLog
): boolean {
  return parseBatches(content)
    .flatMap(collectLogRecords)
    .some((record) =>
      record.eventName === "PkgdOperationCompleted"
      && matchesAttribute(record, "Operation", expected.operation)
      && matchesAttribute(record, "Outcome", expected.outcome)
      && (expected.traceId === undefined
        || record.traceId === expected.traceId));
}

function parseBatches(content: string): unknown[] {
  const batches: unknown[] = [];
  for (const line of content.split("\n")) {
    if (line.trim() === "") {
      continue;
    }

    try {
      batches.push(JSON.parse(line) as unknown);
    } catch {
      continue;
    }
  }
  return batches;
}

function collectLogRecords(batch: unknown): OtlpLogRecord[] {
  if (typeof batch !== "object" || batch === null) {
    return [];
  }

  const resourceLogs = (batch as { resourceLogs?: unknown }).resourceLogs;
  if (!Array.isArray(resourceLogs)) {
    return [];
  }

  const records: OtlpLogRecord[] = [];
  for (const resource of resourceLogs) {
    const scopeLogs = (resource as { scopeLogs?: unknown })?.scopeLogs;
    if (!Array.isArray(scopeLogs)) {
      continue;
    }

    for (const scope of scopeLogs) {
      const logRecords = (scope as { logRecords?: unknown })?.logRecords;
      if (Array.isArray(logRecords)) {
        records.push(...logRecords as OtlpLogRecord[]);
      }
    }
  }
  return records;
}

function matchesAttribute(
  record: OtlpLogRecord,
  key: string,
  expected: string | undefined
): boolean {
  if (expected === undefined) {
    return true;
  }
  if (!Array.isArray(record.attributes)) {
    return false;
  }

  return (record.attributes as OtlpAttribute[]).some((attribute) =>
    attribute.key === key
    && attribute.value?.stringValue === expected);
}
