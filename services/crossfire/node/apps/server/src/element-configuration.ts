import { decodeUtf8 } from '@ctlflow/crossfire-kernel/bytes';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
export type ElementPresentation = Record<string, unknown>;
export function readElementPresentation(directory: string, origin: string): ElementPresentation {
  const path = join(directory, 'config.' + new URL(origin).hostname + '.json');
  if (!existsSync(path)) return {};
  const bytes = readFileSync(path);
  if (bytes.length > 65536) throw new Error('Element presentation configuration exceeds 64 KiB');
  const configuration: unknown = JSON.parse(decodeUtf8(bytes));
  if (!configuration || typeof configuration !== 'object' || Array.isArray(configuration)) throw new Error('Invalid Element presentation configuration');
  const source = configuration as Record<string, unknown>;
  return Object.fromEntries(['brand', 'default_theme', 'branding', 'embedded_pages', 'setting_defaults']
    .filter(key => source[key] !== undefined).map(key => [key, source[key]]));
}
