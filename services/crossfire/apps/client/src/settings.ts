import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fields } from '@ctlflow/crossfire-contracts/validation';
import { readJson, writeJson } from '@ctlflow/crossfire-adapter-filesystem/index';
import { migrateListenerSettings } from './settings-migration.js';

export function listenerSettings(state: string, runtime?: string) {
  const file = join(state, 'settings.json');
  if (existsSync(file)) migrateListenerSettings(file);
  const saved = existsSync(file) ? fields(readJson<unknown>(file), ['runtime']) : undefined;
  if (saved && (!saved.ok || typeof saved.value.runtime !== 'string' || !['codex', 'claude', 'pi'].includes(saved.value.runtime))) throw new Error('Invalid listener settings');
  const value = { runtime: runtime ?? (saved?.ok ? String(saved.value.runtime) : '') };
  if (!['codex', 'claude', 'pi'].includes(value.runtime)) throw new Error('Run connect in a supported coding session; for first-time Pi setup select --runtime pi');
  return { ...value, save: () => writeJson(file, value) };
}
