import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fields, roomId, userId } from '@crossfire/contracts/validation';
import { endpoint } from '@crossfire/contracts/origin';
import { readJson, writeJson } from '@crossfire/adapter-filesystem/index';

export function listenerSettings(state: string, runtime?: string, approvalRoom?: string) {
  const file = join(state, 'settings.json');
  const saved = existsSync(file) ? fields(readJson<unknown>(file), ['runtime', 'approvalRoom', 'server', 'owner']) : undefined;
  if (saved && (!saved.ok || typeof saved.value.runtime !== 'string' || saved.value.approvalRoom !== null && !roomId(saved.value.approvalRoom)
    || typeof saved.value.server !== 'string' || !endpoint(saved.value.server).ok || !userId(saved.value.owner))) throw new Error('Invalid listener settings');
  const value = { runtime: runtime ?? (saved?.ok ? String(saved.value.runtime) : ''),
    approvalRoom: approvalRoom ?? (saved?.ok && (!runtime || runtime === saved.value.runtime) ? saved.value.approvalRoom as string | null : null),
    server: saved?.ok ? saved.value.server as string : null, owner: saved?.ok ? saved.value.owner as string : null };
  if (value.approvalRoom !== null && !roomId(value.approvalRoom)) throw new Error('Choose an exact authorized room for human approvals');
  if (!['codex', 'claude', 'pi'].includes(value.runtime)) throw new Error('Run connect in a supported coding session; for first-time Pi setup select --runtime pi');
  if (value.approvalRoom !== null && value.runtime !== 'codex') throw new Error('This adapter retains native permission handling in the coding session; Crossfire approval routing is available only for Codex');
  return { ...value, save: (server: string, owner: string) => {
    const parsed = endpoint(server);
    if (!parsed.ok || parsed.value !== server || !userId(owner)) throw new Error('Invalid project connection server or owner');
    if (value.server && value.server !== server || value.owner && value.owner !== owner) throw new Error('This setup belongs to a different server or owner; its choices are unchanged');
    writeJson(file, { ...value, server, owner });
  } };
}

export function listenerBinding(runtimeBinding: string, approvalRoom: string | null): string {
  return createHash('sha256').update(JSON.stringify([runtimeBinding, approvalRoom])).digest('hex');
}
