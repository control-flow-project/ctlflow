export interface OtlpSpan {
  readonly attributes?: readonly OtlpAttribute[];
  readonly name?: unknown;
  readonly spanId?: unknown;
  readonly parentSpanId?: unknown;
  readonly traceId?: unknown;
}

interface OtlpAttribute {
  readonly key?: unknown;
  readonly value?: {
    readonly stringValue?: unknown;
  };
}

export function findSpansForTrace(
  content: string,
  traceId: string
): OtlpSpan[] {
  const spans: OtlpSpan[] = [];
  for (const line of content.split("\n")) {
    if (line.trim() === "") {
      continue;
    }
    try {
      spans.push(
        ...collectSpans(JSON.parse(line) as unknown)
          .filter((span) => span.traceId === traceId));
    } catch {
      continue;
    }
  }
  return spans;
}

function collectSpans(batch: unknown): OtlpSpan[] {
  if (typeof batch !== "object" || batch === null) {
    return [];
  }
  const resourceSpans = (batch as {
    resourceSpans?: unknown;
  }).resourceSpans;
  if (!Array.isArray(resourceSpans)) {
    return [];
  }
  const spans: OtlpSpan[] = [];
  for (const resource of resourceSpans) {
    const scopeSpans = (resource as {
      scopeSpans?: unknown;
    })?.scopeSpans;
    if (!Array.isArray(scopeSpans)) {
      continue;
    }
    for (const scope of scopeSpans) {
      const inner = (scope as { spans?: unknown })?.spans;
      if (Array.isArray(inner)) {
        spans.push(...inner as OtlpSpan[]);
      }
    }
  }
  return spans;
}
