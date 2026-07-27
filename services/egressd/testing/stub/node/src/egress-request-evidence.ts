export interface EgressRequestEvidence {
  readonly method: string;
  readonly path: string;
  readonly host: string;
  readonly authorization: string;
  readonly accept: string;
  readonly contentType?: string;
  readonly contentLength?: string;
  readonly traceparent?: string;
  readonly tracestate?: string;
  readonly body: string;
}
