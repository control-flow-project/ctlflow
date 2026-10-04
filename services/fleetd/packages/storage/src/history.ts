import { existsSync, unlinkSync, openSync, closeSync, fsyncSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { readJson, writeJson } from '@crossfire/adapter-filesystem/index';
import * as check from '@crossfire/contracts/schema/validation';

const initialization = check.object({ agentId: check.identifier, resetId: check.nullable(check.identifier) });
function file(directory: string, agentId: string): string {
  if (!check.identifier(agentId).ok) throw new Error('Invalid history initialization identity');
  return join(directory, '.fleet', 'history-initialization', agentId + '.json');
}
export function initializeHistory(directory: string, agentId: string, resetId: string | null): void {
  const parsed = initialization({ agentId, resetId }); if (!parsed.ok) throw new Error(parsed.error.message);
  writeJson(file(directory, agentId), parsed.value);
}
export function canInitializeHistory(directory: string, agentId: string): boolean {
  const path = file(directory, agentId); if (!existsSync(path)) return false;
  const parsed = initialization(readJson<unknown>(path));
  if (!parsed.ok || parsed.value.agentId !== agentId) throw new Error('History initialization does not match its enrolled identity');
  return true;
}
export function initializedHistory(directory: string, agentId: string): void {
  if (!canInitializeHistory(directory, agentId)) return;
  const path = file(directory, agentId); unlinkSync(path);
  const descriptor = openSync(dirname(path), 'r');
  try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
}
