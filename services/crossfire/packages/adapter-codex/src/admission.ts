import { object } from '@ctlflow/crossfire-contracts/validation';
import { failure, success, type Result } from '@ctlflow/crossfire-kernel/result';

type Request = (method: string, params: unknown) => Promise<unknown>;
type Model = { model: string; isDefault: boolean; defaultEffort: string; efforts: string[] };
export type NativeSelection = { model: string; effort: string };

export async function admitCodex(request: Request, configured: Record<string, unknown>): Promise<Result<NativeSelection>> {
  const read = object(await request('config/read', { includeLayers: false }));
  const configuration = read.ok ? object(read.value.config) : read;
  if (!configuration.ok) return failure('native', 'Codex did not expose its effective native configuration');
  const models: Model[] = [], cursors = new Set<string>();
  let cursor: string | undefined;
  do {
    const listing = object(await request('model/list', { includeHidden: true, limit: 100, ...(cursor ? { cursor } : {}) }));
    if (!listing.ok || !Array.isArray(listing.value.data) || models.length + listing.value.data.length > 2000 || cursors.size >= 2000) return failure('native', 'Invalid or excessive native model catalog');
    for (const value of listing.value.data) {
      const model = object(value);
      if (!model.ok || typeof model.value.model !== 'string' || !model.value.model || typeof model.value.isDefault !== 'boolean'
        || typeof model.value.defaultReasoningEffort !== 'string' || !Array.isArray(model.value.supportedReasoningEfforts)) return failure('native', 'Invalid native model capabilities');
      const efforts: string[] = [];
      for (const value of model.value.supportedReasoningEfforts) {
        const effort = object(value);
        if (!effort.ok || typeof effort.value.reasoningEffort !== 'string' || !effort.value.reasoningEffort) return failure('native', 'Invalid native reasoning capabilities');
        efforts.push(effort.value.reasoningEffort);
      }
      if (models.some(item => item.model === model.value.model) || new Set(efforts).size !== efforts.length || !efforts.includes(model.value.defaultReasoningEffort)) return failure('native', 'Ambiguous native model catalog or unsupported native default effort');
      models.push({ model: model.value.model, isDefault: model.value.isDefault, defaultEffort: model.value.defaultReasoningEffort, efforts });
    }
    const next = listing.value.nextCursor;
    if (next !== undefined && next !== null && (typeof next !== 'string' || !next || next.length > 4096 || !listing.value.data.length || cursors.has(next))) return failure('native', 'Invalid native model catalog pagination');
    cursor = typeof next === 'string' ? next : undefined;
    if (cursor) cursors.add(cursor);
  } while (cursor);
  const selected = configured.model ?? configuration.value.model;
  const defaults = models.filter(model => model.isDefault);
  const model = selected === undefined || selected === null ? defaults.length === 1 ? defaults[0] : undefined : models.find(model => model.model === selected);
  if (!model) return failure('invalid', 'Configured or default model is unavailable in this native engine; select an exact advertised model');
  const effort = configured.model_reasoning_effort ?? configuration.value.model_reasoning_effort ?? model.defaultEffort;
  if (typeof effort !== 'string' || !model.efforts.includes(effort)) return failure('invalid', 'Reasoning effort ' + String(effort) + ' is unavailable for model ' + model.model + '; no model or effort was substituted');
  return success({ model: model.model, effort });
}
