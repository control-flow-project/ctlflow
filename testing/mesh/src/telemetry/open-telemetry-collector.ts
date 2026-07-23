export interface OpenTelemetryCollector {
  readonly endpoint: string;
  readonly tracesPath: string;
  readonly metricsPath: string;
  readonly logsPath: string;
  readonly stop: () => Promise<void>;
}
