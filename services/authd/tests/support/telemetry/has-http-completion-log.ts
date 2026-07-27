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

export function hasHttpCompletionLog(
  content: string,
  operation: string,
  outcome: string,
  traceId: string
): boolean {
  return readLogRecords(content).some((record) =>
    record.eventName === "AuthdHttpCompleted"
    && record.traceId === traceId
    && hasAttribute(record, "Operation", operation)
    && hasAttribute(record, "Outcome", outcome));
}

function readLogRecords(content: string): OtlpLogRecord[] {
  const records: OtlpLogRecord[] = [];
  for (const line of content.split("\n")) {
    if (line.trim() === "") {
      continue;
    }

    let batch: unknown;
    try {
      batch = JSON.parse(line) as unknown;
    } catch {
      continue;
    }
    if (typeof batch !== "object" || batch === null) {
      continue;
    }

    const resources =
      (batch as { resourceLogs?: unknown }).resourceLogs;
    if (!Array.isArray(resources)) {
      continue;
    }
    for (const resource of resources) {
      const scopes =
        (resource as { scopeLogs?: unknown })?.scopeLogs;
      if (!Array.isArray(scopes)) {
        continue;
      }
      for (const scope of scopes) {
        const values =
          (scope as { logRecords?: unknown })?.logRecords;
        if (Array.isArray(values)) {
          records.push(...values as OtlpLogRecord[]);
        }
      }
    }
  }
  return records;
}

function hasAttribute(
  record: OtlpLogRecord,
  key: string,
  expected: string
): boolean {
  return Array.isArray(record.attributes)
    && (record.attributes as OtlpAttribute[]).some((attribute) =>
      attribute.key === key
      && attribute.value?.stringValue === expected);
}
