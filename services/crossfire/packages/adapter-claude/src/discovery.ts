import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { readJson } from '@ctlflow/crossfire-adapter-filesystem/index';
import { object } from '@ctlflow/crossfire-contracts/validation';
import type { RuntimeAdapter } from '@ctlflow/crossfire-agent-core/runtime';
import { claudeContextFile } from './hook.js';
import { nativeClaude, type ClaudeContext } from './context.js';
import { connectClaude } from './connection.js';

export function discoverClaude(workspace: string, environment: NodeJS.ProcessEnv = process.env) {
  const native = nativeClaude(environment, workspace);
  const file = claudeContextFile(native.workspace, native.session);
  if (!existsSync(file)) throw new Error('Claude native context is not ready. Let this setup command finish so its project hook can run, then run agent connect once more in this session.');
  const parsed = object(readJson<unknown>(file));
  if (!parsed.ok || Object.entries(native).some(([key, value]) => parsed.value[key] !== value) || typeof parsed.value.transcript !== 'string') {
    throw new Error('Claude project hook context differs from this native attachment');
  }
  const context: ClaudeContext = { ...native, transcript: parsed.value.transcript };
  const binding = createHash('sha256').update(JSON.stringify(context)).digest('hex');
  const runtime: RuntimeAdapter = (stop, pollMs, hooks) => connectClaude(context, { journal: join(workspace, '.crossfire/runtime/claude', native.session + '.receipt'), pollMs, hooks }, stop);
  return { name: 'claude', session: native.session, binding, runtime };
}
