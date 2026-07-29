export interface OtlpSpan {
  readonly name?: unknown;
  readonly parentSpanId?: unknown;
  readonly spanId?: unknown;
  readonly traceId?: unknown;
}

export function readOtlpSpans(content: string): OtlpSpan[] {
  const spans: OtlpSpan[] = [];
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
      (batch as { resourceSpans?: unknown }).resourceSpans;
    if (!Array.isArray(resources)) {
      continue;
    }
    for (const resource of resources) {
      const scopes =
        (resource as { scopeSpans?: unknown })?.scopeSpans;
      if (!Array.isArray(scopes)) {
        continue;
      }
      for (const scope of scopes) {
        const values = (scope as { spans?: unknown })?.spans;
        if (Array.isArray(values)) {
          spans.push(...values as OtlpSpan[]);
        }
      }
    }
  }
  return spans;
}
