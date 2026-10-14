import { failureError } from '@ctlflow/crossfire-kernel/result';
import { record, type PiProcess } from './protocol.js';

export async function admitPi(native: PiProcess, options: Record<string, unknown>) {
  const available = record(await native.request('get_available_models'));
  if (!Array.isArray(available.models) || available.models.length > 20000) throw failureError({ code: 'invalid', message: 'Invalid native Pi model availability' });
  const models = available.models.map(record);
  if (options.model !== undefined) {
    if (!models.some(model => model.provider === options.provider && model.id === options.model)) throw failureError({ code: 'invalid', message: 'Unavailable Pi model: ' + String(options.provider) + '/' + String(options.model) + '; no substitution was made' });
    const selected = record(await native.request('set_model', { provider: options.provider, modelId: options.model }));
    if (selected.provider !== options.provider || selected.id !== options.model) throw failureError({ code: 'conflict', message: 'Pi substituted the configured model' });
  }
  const levels = record(await native.request('get_available_thinking_levels'));
  if (!Array.isArray(levels.levels) || !levels.levels.every(value => typeof value === 'string')) throw failureError({ code: 'invalid', message: 'Invalid native Pi thinking levels' });
  if (options.thinking_level !== undefined) {
    if (!levels.levels.some(value => value === options.thinking_level)) throw failureError({ code: 'invalid', message: 'Pi model does not support thinking_level=' + String(options.thinking_level) + '; no clamping or substitution was made' });
    await native.request('set_thinking_level', { level: options.thinking_level });
  }
  const state = record(await native.request('get_state')), model = record(state.model);
  if (!models.some(value => value.provider === model.provider && value.id === model.id)
    || options.model !== undefined && (model.id !== options.model || model.provider !== options.provider)
    || options.thinking_level !== undefined && state.thinkingLevel !== options.thinking_level) throw failureError({ code: 'conflict', message: 'Pi effective settings differ from native admission' });
  if (typeof model.provider !== 'string' || typeof model.id !== 'string' || typeof state.thinkingLevel !== 'string') throw failureError({ code: 'invalid', message: 'Invalid effective Pi model' });
  return { state, settings: [
    { name: 'provider', configured: typeof options.provider === 'string' ? options.provider : null, effective: model.provider },
    { name: 'model', configured: typeof options.model === 'string' ? options.model : null, effective: model.id },
    { name: 'thinking_level', configured: typeof options.thinking_level === 'string' ? options.thinking_level : null, effective: state.thinkingLevel },
    { name: 'native_version', configured: null, effective: native.version } ] };
}
