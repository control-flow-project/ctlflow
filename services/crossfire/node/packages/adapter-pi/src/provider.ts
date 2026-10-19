import { failure, success, type Result } from '@ctlflow/crossfire-kernel/result';
import type { ProviderState } from '@ctlflow/crossfire-agent-core/owned-runtime';
import { record, type PiProcess } from './protocol.js';

export async function providerState(native: PiProcess, signal: AbortSignal): Promise<Result<ProviderState>> {
  try {
    const state: unknown = await native.request('get_state', {}, signal);
    const available: unknown = await native.request('get_available_models', {}, signal);
    return parseProvider(state, available);
  } catch { return failure('unavailable', 'Native provider metadata could not be read without refresh'); }
}

export function parseProvider(stateValue: unknown, availableValue: unknown): Result<ProviderState> {
  try {
    const state = record(stateValue), model = record(state.model), available = record(availableValue);
    if (typeof model.provider !== 'string' || typeof model.id !== 'string') return failure('native', 'Native provider metadata is invalid');
    if (!Array.isArray(available.models) || available.models.length > 20000) return failure('native', 'Native provider metadata is invalid');
    const models = available.models.map(record);
    if (models.some(entry => typeof entry.provider !== 'string' || typeof entry.id !== 'string')) return failure('native', 'Native provider metadata is invalid');
    return success(models.some(entry => entry.provider === model.provider && entry.id === model.id) ? 'present' : 'missing');
  } catch { return failure('native', 'Native provider metadata is invalid'); }
}
