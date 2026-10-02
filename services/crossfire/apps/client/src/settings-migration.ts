import { fields, roomId } from '@crossfire/contracts/validation';
import { readJson, writeJson } from '@crossfire/adapter-filesystem/index';

export function migrateListenerSettings(file: string): void {
  const source = readJson<unknown>(file);
  if (!source || typeof source !== 'object' || !Object.hasOwn(source, 'approvalRoom')) return;
  const previous = fields(source, ['runtime', 'approvalRoom']);
  if (!previous.ok || typeof previous.value.runtime !== 'string' || !['codex', 'claude', 'pi'].includes(previous.value.runtime)
    || previous.value.approvalRoom !== null && !roomId(previous.value.approvalRoom)) throw new Error('Invalid listener settings');
  writeJson(file, { runtime: previous.value.runtime });
}
