import type { Result } from '@ctlflow/crossfire-kernel/result';

export type LoggingRetention = {
  days: number;
  prune(cutoff: number, limit: number): Result<{ removed: number; more: boolean }>;
};

export type DiagnosticLog = {
  write(message: string): void;
  maintenanceError(message: string | null): void;
  prune(): Promise<Result<void>>;
  error(): string | null;
  close(): void;
};
