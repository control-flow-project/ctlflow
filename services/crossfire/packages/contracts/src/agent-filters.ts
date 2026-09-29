import type { ActivityView } from './activity.js';
import type { Status } from './management.js';
import { failure, success, type Result } from '../../kernel/src/result.js';

export const AGENT_STATUSES = ['active', 'suspended', 'revoked'] as const;
export const LISTENER_STATUSES = ['all', 'online', 'offline', 'disconnecting'] as const;
export const DEFAULT_AGENT_STATUSES: readonly Status[] = ['active', 'suspended'];
export type AgentFilters = { statuses: Status[]; listener: 'all' | ActivityView['status'] };

export function agentFilters(query: URLSearchParams): Result<AgentFilters> {
  if ([...query.keys()].some(key => !['after', 'limit', 'status', 'listener'].includes(key))
    || ['status', 'listener'].some(key => query.getAll(key).length > 1)) return failure('invalid', 'Invalid agent filters');
  const selection = query.get('status') ?? DEFAULT_AGENT_STATUSES.join(',');
  const statuses = selection === '' ? [] : selection.split(',');
  const listener = query.get('listener') ?? 'all';
  if (statuses.some(status => !AGENT_STATUSES.some(allowed => allowed === status)) || new Set(statuses).size !== statuses.length
    || !LISTENER_STATUSES.some(allowed => allowed === listener)) return failure('invalid', 'Invalid agent filters');
  return success({ statuses: AGENT_STATUSES.filter(status => statuses.includes(status)), listener: listener as AgentFilters['listener'] });
}
