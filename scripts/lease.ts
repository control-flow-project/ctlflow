export const LEASE_TIMEOUT_MS = 30_000;
export const HEARTBEAT_INTERVAL_MS = 2_000;
export type Heartbeat = { run_id: string; sequence: number; stopped?: boolean };

export class Lease {
  runId: string;
  lastChange: number;
  sequence = -1;
  stopped = false;
  constructor(runId: string, now = performance.now()) { this.runId = runId; this.lastChange = now; }
  observe(heartbeat: Heartbeat, now = performance.now()): void {
    if (heartbeat.run_id !== this.runId || !Number.isSafeInteger(heartbeat.sequence)) return;
    if (heartbeat.stopped) this.stopped = true;
    if (heartbeat.sequence > this.sequence) { this.sequence = heartbeat.sequence; this.lastChange = now; }
  }
  expired(now = performance.now()): boolean { return this.stopped || now - this.lastChange >= LEASE_TIMEOUT_MS; }
}
