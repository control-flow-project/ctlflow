import { createClient, type ClientOptions } from '@ctlflow/crossfire-client/client';
import { operations } from '@ctlflow/crossfire-contracts/rest/operations';
import { failure } from '@ctlflow/crossfire-kernel/result';

export function roomAccess(options: ClientOptions) {
  const client = createClient(options);
  return {
    directory: (search: string, page: number, pageSize: number) => client.call(operations.principals, {}, {}, new URLSearchParams({ kind: 'agent', search, page: String(page), pageSize: String(pageSize) })),
    read: (agentId: string, roomId: string) => client.call(operations.grant, { agentId, roomId }, {}),
    async change(agentId: string, roomId: string, intent: { accessMode: 'read' | 'reply' | 'custom'; powerLevel: number | null } | null) {
      const current = await client.call(operations.grant, { agentId, roomId }, {});
      if (!current.ok) return current;
      if (!current.value.data.allowedActions.includes(intent ? 'set' : 'remove')) return failure('forbidden', 'This agent lacks authority for that room operation');
      const expected = { expectedRevision: current.value.data.revision, expectedGeneration: current.value.data.grant?.generation ?? null };
      return intent ? client.call(operations.setGrant, { agentId, roomId }, { ...expected, ...intent, muted: current.value.data.grant?.muted ?? false })
        : client.call(operations.removeGrant, { agentId, roomId }, expected);
    },
  };
}
