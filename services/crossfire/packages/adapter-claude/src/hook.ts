import { join, isAbsolute } from 'node:path';
import { realpathSync, existsSync } from 'node:fs';
import { object } from '@crossfire/contracts/validation';
import { writeJson } from '@crossfire/adapter-filesystem/index';
import { ignoreProjectPaths } from '@crossfire/adapter-filesystem/project';
import { projectConfiguration, saveProjectConfiguration, shellQuote } from '@crossfire/adapter-runtime/project-config';
import { nativeClaude } from './context.js';

export function claudeContextFile(workspace: string, session: string): string { return join(workspace, '.crossfire/runtime/claude', session + '.json'); }

export function installClaudeHook(workspace: string): void {
  ignoreProjectPaths(workspace, ['.claude/settings.local.json']);
  const path = join(workspace, '.claude/settings.local.json');
  const settings = projectConfiguration(path);
  const parsed = object(settings.hooks ?? {});
  if (!parsed.ok) throw new Error('Invalid Claude project hooks');
  const hooks = parsed.value;
  const command = shellQuote(process.execPath) + ' ' + shellQuote(join(workspace, '.crossfire/client.mjs')) + ' runtime claude-hook';
  let changed = false;
  for (const event of ['SessionStart', 'PreToolUse', 'PostToolUse']) {
    const entries: unknown = hooks[event] ?? [];
    if (!Array.isArray(entries)) throw new Error('Invalid Claude project hook list');
    const existing = entries.some(entry => {
      const parsed = object(entry);
      return parsed.ok && Array.isArray(parsed.value.hooks) && parsed.value.hooks.some(hook => {
        const value = object(hook); return value.ok && value.value.type === 'command' && value.value.command === command;
      });
    });
    if (!existing) { hooks[event] = [...entries, { matcher: event === 'SessionStart' ? '' : 'Bash', hooks: [{ type: 'command', command, timeout: 10 }] }]; changed = true; }
  }
  if (changed) saveProjectConfiguration(path, { ...settings, hooks });
}

export function recordClaudeHook(input: unknown, environment: NodeJS.ProcessEnv = process.env): void {
  const parsed = object(input);
  if (!parsed.ok || !['PreToolUse', 'PostToolUse', 'SessionStart'].includes(String(parsed.value.hook_event_name)) || typeof parsed.value.cwd !== 'string'
    || typeof parsed.value.transcript_path !== 'string' || !isAbsolute(parsed.value.transcript_path)) throw new Error('Invalid native Claude hook context');
  const native = nativeClaude(environment, parsed.value.cwd);
  if (native.session !== parsed.value.session_id) throw new Error('Claude hook belongs to a different session');
  if (!existsSync(parsed.value.transcript_path) && parsed.value.hook_event_name === 'SessionStart') return;
  writeJson(claudeContextFile(native.workspace, native.session), { ...native, transcript: realpathSync(parsed.value.transcript_path) });
}
