import { setTimeout as delay } from 'node:timers/promises';
import { operations, type createDaemonClient } from '@ctlflow/fleet-daemon-client/client';
import type { OperationView } from '@ctlflow/fleetd-contracts/api';

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
