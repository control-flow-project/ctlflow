export interface OpenTelemetryCollector {
  readonly endpoint: string;
  readonly tracesPath: string;
  readonly metricsPath: string;
  readonly logsPath: string;
  readonly clearExports: () => Promise<void>;
  readonly suspend: () => Promise<void>;
  readonly resume: () => Promise<void>;
  readonly stop: () => Promise<void>;
}
