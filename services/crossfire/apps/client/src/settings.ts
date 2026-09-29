import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fields, roomId } from '@crossfire/contracts/validation';
import { readJson, writeJson } from '@crossfire/adapter-filesystem/index';

export function listenerSettings(state: string, runtime?: string, approvalRoom?: string) {
  const file = join(state, 'settings.json');
  const saved = existsSync(file) ? fields(readJson<unknown>(file), ['runtime', 'approvalRoom']) : undefined;
  if (saved && (!saved.ok || typeof saved.value.runtime !== 'string' || saved.value.approvalRoom !== null && !roomId(saved.value.approvalRoom))) throw new Error('Invalid listener settings');
  const value = { runtime: runtime ?? (saved?.ok ? String(saved.value.runtime) : 'codex'),
    approvalRoom: approvalRoom ?? (saved?.ok ? saved.value.approvalRoom as string | null : null) };
  if (value.approvalRoom !== null && !roomId(value.approvalRoom)) throw new Error('Choose an exact authorized room for human approvals');
  return { ...value, save: () => writeJson(file, value) };
}

export function listenerBinding(runtimeBinding: string, approvalRoom: string | null): string {
  return createHash('sha256').update(JSON.stringify([runtimeBinding, approvalRoom])).digest('hex');
}
