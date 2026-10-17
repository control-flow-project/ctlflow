import { setTimeout as delay } from 'node:timers/promises';
import { operations, type createDaemonClient } from '@ctlflow/fleet-daemon-client/client';
import type { FleetView, OperationView } from '@ctlflow/fleetd-contracts/api';

export async function listFleets(client: ReturnType<typeof createDaemonClient>): Promise<FleetView[]> {
  const fleets: FleetView[] = [];
  for (let page = 1; page <= 100000; page++) {
    const response = await client.call(operations.fleets, {}, {}, new URLSearchParams({ page: String(page), pageSize: '100' }));
    if (!response.ok) throw new Error(response.error.code + ': ' + response.error.message);
    fleets.push(...response.value.data);
    const pages = response.value.meta.totalPages;
    if (pages === undefined) throw new Error('Fleet pagination metadata is missing');
    if (page >= pages) return fleets;
  }
  throw new Error('Fleet pagination exceeded its bound');
}

export async function observeOperation(client: ReturnType<typeof createDaemonClient>, initial: OperationView,
  signal: AbortSignal, output: (value: unknown) => void): Promise<OperationView> {
  let operation = initial, notified = '';
  for (;;) {
    signal.throwIfAborted();
    if (operation.approval && operation.approval.code !== notified) {
      output({ status: 'awaiting-approval', ...operation.approval }); notified = operation.approval.code;
    }
    if (operation.status === 'failed') {
      output(operation); throw new Error('Operation failed; successful peers and saved histories are retained. Inspect fleet show FLEET and retry explicitly.');
    }
    if (operation.status === 'succeeded') return operation;
    await delay(250, undefined, { signal });
    const observed = await client.call(operations.operation, { operationId: operation.operationId }, {});
    if (!observed.ok) throw new Error(observed.error.message + '; the operation continues in fleetd. Retry with operation ID ' + operation.operationId);
    operation = observed.value.data;
  }
}
