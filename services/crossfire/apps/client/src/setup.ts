import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fields, userId } from '@crossfire/contracts/validation';
import { endpoint } from '@crossfire/contracts/origin';
import { readJson, writeJson } from '@crossfire/adapter-filesystem/index';

export function connectionSetup(state: string) {
  const file = join(state, 'setup.json');
  const saved = existsSync(file) ? fields(readJson<unknown>(file), ['server', 'owner']) : undefined;
  if (saved && (!saved.ok || typeof saved.value.server !== 'string'
    || !endpoint(saved.value.server).ok || !userId(saved.value.owner))) throw new Error('Invalid project connection setup');
  const value = saved?.ok ? { server: String(saved.value.server), owner: String(saved.value.owner) } : undefined;
  if (value) {
    const origin = endpoint(value.server);
    if (!origin.ok || origin.value !== value.server) throw new Error('Invalid project connection setup');
  }
  return {
    value,
    save(server: string, owner: string): void {
      const parsed = endpoint(server);
      if (!parsed.ok || parsed.value !== server || !userId(owner)) throw new Error('Invalid project connection server or owner');
      if (value && (value.server !== server || value.owner !== owner)) throw new Error('This setup belongs to a different server or owner; its choices are unchanged');
      writeJson(file, { server, owner });
    },
    complete(): void { if (existsSync(file)) unlinkSync(file); },
  };
}
