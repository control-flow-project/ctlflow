import { operations } from '@ctlflow/crossfire-contracts/rest/operations';
import type { FleetRuntimeOperation } from '@ctlflow/crossfire-contracts/fleet-runtime';
import type { Result } from '@ctlflow/crossfire-kernel/result';
import type { Client } from './client.js';

export type FleetRuntimeExecutor = (operation: FleetRuntimeOperation) => Promise<Result<{ status: 'succeeded' | 'failed'; errorMessage: string | null }>>;
export function createFleetRuntimeWorker(options: { client: Client; fleetId: string; execute: FleetRuntimeExecutor;
  acknowledged(operationId: string): Result<void>;
  connection(): { connected: boolean; id: string }; fail(message: string): void }) {
  let running: Promise<void> | undefined;
  function receive(operation: FleetRuntimeOperation): void {
    if (running || !options.connection().connected) return;
    running = (async () => {
      const generation = options.connection().id;
      const claim = await options.client.call(operations.claimFleetRuntime, { fleetId: options.fleetId, operationId: operation.operationId }, { connectionId: generation });
      if (!claim.ok) throw new Error(claim.error.message);
      if (claim.value.data.status === 'succeeded' || claim.value.data.status === 'failed') {
        const acknowledged = options.acknowledged(operation.operationId); if (!acknowledged.ok) throw new Error(acknowledged.error.message);
        return;
      }
      if (claim.value.data.status !== 'running') throw new Error('Controller claim did not authorize native execution');
      const result = await options.execute(claim.value.data);
      const outcome = result.ok ? result.value : { status: 'failed' as const, errorMessage: result.error.message };
      const receipt = await options.client.call(operations.receiptFleetRuntime, { fleetId: options.fleetId, operationId: operation.operationId },
        { connectionId: generation, status: outcome.status, errorMessage: outcome.errorMessage?.replace(/[\u0000-\u001f\u007f]/gu, ' ').slice(0, 4096) ?? null });
      if (!receipt.ok) throw new Error(receipt.error.message);
      const acknowledged = options.acknowledged(operation.operationId); if (!acknowledged.ok) throw new Error(acknowledged.error.message);
    })().catch(error => options.fail(error instanceof Error ? error.message : 'Session control failed')).finally(() => { running = undefined; });
  }
  return { receive, close: async () => { await running; } };
}
