import type { Result } from '@ctlflow/crossfire-kernel/result';
import type { Page, PageRequest } from '../port/directory.js';

export type RuntimeOperation = { operationId: string; fleetId: string; agentId: string | null; action: 'start' | 'stop' | 'reset';
  expectedRevision: number; authorPrincipalId: string; status: 'pending' | 'running' | 'succeeded' | 'failed';
  createdAt: number; completedAt: number | null; errorMessage: string | null; connectionId: string | null; credentialId: string | null };
export type RuntimeOperationView = Omit<RuntimeOperation, 'authorPrincipalId' | 'connectionId' | 'credentialId'>;
export type RuntimeOperationRepository = {
  find(operationId: string): Result<RuntimeOperation | null>;
  pending(fleetId: string): Result<RuntimeOperation | null>;
  page(fleetId: string, page: PageRequest): Result<Page<RuntimeOperation>>;
  insert(operation: RuntimeOperation): Result<void>;
  update(operation: RuntimeOperation): Result<void>;
};
export function runtimeOperationView(operation: RuntimeOperation): RuntimeOperationView {
  const { authorPrincipalId: _author, connectionId: _connection, credentialId: _credential, ...view } = operation;
  return view;
}
