import { discoverCodex } from '@crossfire/adapter-codex/discovery';
import { discoverClaude } from '@crossfire/adapter-claude/discovery';
import { installClaudeHook } from '@crossfire/adapter-claude/hook';
import { nativeClaude } from '@crossfire/adapter-claude/context';
import { claudeContextFile } from '@crossfire/adapter-claude/hook';
import { existsSync } from 'node:fs';
import { discoverPi, installPiExtension } from '@crossfire/adapter-pi/discovery';

const adapters = { codex: discoverCodex, claude: discoverClaude, pi: discoverPi };
export function runtimeName(requested?: string, environment: NodeJS.ProcessEnv = process.env): string | undefined {
  if (requested) return requested;
  const names = [environment.CLAUDE_CODE_SESSION_ID && 'claude', environment.CROSSFIRE_PI_CONNECTION && 'pi', environment.CODEX_THREAD_ID && 'codex'].filter(Boolean);
  if (names.length > 1) throw new Error('Multiple runtime contexts are present; choose the current coding session with --runtime');
  return names[0] as string | undefined;
}

export function prepareRuntime(name: string, workspace: string): string | undefined {
  if (name === 'claude') {
    const native = nativeClaude(process.env, workspace); installClaudeHook(workspace);
    if (!existsSync(claudeContextFile(workspace, native.session))) return 'Let this successful installation command finish. Claude Code loads the project hooks automatically; its next Bash tool call captures the exact native context. Run agent connect again in that session. No new identity, restart or manual connection details are needed.';
  } else if (name === 'pi') {
    installPiExtension(workspace);
    if (!process.env.CROSSFIRE_PI_CONNECTION) return 'The verified Pi project extension is installed. Use /reload once in this Pi session, then run agent connect again. Pi loads new project extensions on reload, not while a tool is running. Do not create another identity.';
  }
  else if (name !== 'codex') throw new Error('Supported runtime adapters: codex, claude, pi');
  return undefined;
}

export function discoverRuntime(name: string, workspace: string) {
  if (name !== 'codex' && name !== 'claude' && name !== 'pi') throw new Error('Supported runtime adapters: codex, claude, pi');
  return adapters[name](workspace);
}
