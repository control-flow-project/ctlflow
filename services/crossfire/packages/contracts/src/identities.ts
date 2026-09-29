import { fields, text, userId } from './management.js';
import { failure, success, type Result } from '../../kernel/src/result.js';
import type { WakeAuthor } from './wake.js';

export function parseIdentities(value: unknown): Result<WakeAuthor[]> {
  if (!Array.isArray(value) || value.length > 2000) return failure('invalid', 'Invalid identity directory');
  const identities: WakeAuthor[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const parsed = fields(item, ['id', 'label', 'kind', 'owner']);
    if (!parsed.ok) return parsed;
    const entry = parsed.value;
    if (!userId(entry.id) || !userId(entry.owner) || !text(entry.label, 300)
      || entry.kind !== 'human' && entry.kind !== 'agent' || entry.kind === 'human' && entry.id !== entry.owner
      || seen.has(entry.id)) return failure('invalid', 'Invalid identity directory entry');
    seen.add(entry.id);
    identities.push(entry as WakeAuthor);
  }
  return success(identities);
}
