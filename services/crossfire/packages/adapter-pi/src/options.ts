import * as check from '@ctlflow/crossfire-contracts/schema/validation';
import { failure, success } from '@ctlflow/crossfire-kernel/result';

export const piThinking = check.choice('off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max');
const options = check.object({ provider: check.optional(check.text(200)), model: check.optional(check.text(200)),
  thinking_level: check.optional(piThinking) });
export function piOptions(input: unknown) {
  const parsed = options(input);
  if (!parsed.ok) return parsed;
  if ((parsed.value.provider === undefined) !== (parsed.value.model === undefined)) return failure('invalid', 'Pi provider and model must be configured together with exact native identities');
  return success({ options: parsed.value, approval: 'none' as const });
}
export function configuredSettings(options: Record<string, unknown>) {
  return ['provider', 'model', 'thinking_level'].filter(name => options[name] !== undefined)
    .map(name => ({ name, configured: String(options[name]), effective: null }));
}
export function piVersion(input: string) {
  return /^1\.0\.0$/u.test(input.trim()) ? success(input.trim())
    : failure('invalid', 'The Pi adapter requires verified @earendil-works/pi-coding-agent 1.0.0; other native protocols have not been admitted');
}
