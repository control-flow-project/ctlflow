import { execFile } from 'node:child_process';
import { failure, success, type Result } from '@ctlflow/crossfire-kernel/result';
import { effectiveProvider, hostHome, nativeConfiguration, nativeDirectories, prepareHome } from './home.js';
import { ownedOptions, ownedQuestionCapability, ownedVersion } from './owned-options.js';
import { inspectInstructionCapability } from './capability.js';

export function nativeEnvironment(home: string, stateDirectory: string, profile?: string): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { ...process.env, CODEX_HOME: home, CROSSFIRE_PROJECT: stateDirectory };
  delete environment.CODEX_THREAD_ID;
  delete environment.CROSSFIRE_AGENT_NAME;
  if (profile !== undefined) environment.CROSSFIRE_AGENT_NAME = profile;
  return environment;
}

function command(binary: string, args: string[], workspace: string, environment: NodeJS.ProcessEnv, stop: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(binary, args, { cwd: workspace, env: environment, encoding: 'utf8', timeout: 10000, maxBuffer: 65536, signal: stop }, (error, stdout) => {
      if (error) reject(new Error('Native Codex prerequisite command failed: ' + args.join(' ')));
      else resolve(stdout);
    });
  });
}

export async function inspectCodex(binary: string, input: { workspace: string; stateDirectory: string; options: Record<string, unknown> }, stop: AbortSignal): Promise<Result<void>> {
  const parsed = ownedOptions(input.options);
  if (!parsed.ok) return parsed;
  try {
    stop.throwIfAborted();
    nativeDirectories(input);
    const home = prepareHome(input.stateDirectory), environment = nativeEnvironment(home, input.stateDirectory);
    const version = ownedVersion((await command(binary, ['--version'], input.workspace, environment, stop)).trim());
    if (!version.ok) return version;
    const instructions = await inspectInstructionCapability(binary, home, input.workspace, environment, stop);
    if (!instructions.ok) return instructions;
    const listing = await command(binary, ['features', 'list'], input.workspace, environment, stop);
    if (parsed.value.options.features?.default_mode_request_user_input === true) {
      const supported = ownedQuestionCapability(listing);
      if (!supported.ok) return supported;
    }
    const provider = effectiveProvider(nativeConfiguration(home));
    const key = provider.settings.env_key;
    if (key !== undefined && (typeof key !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key) || !environment[key]?.trim())) {
      return failure('invalid', 'The configured native model provider requires its API-key environment variable; configure it privately before fleet setup');
    }
    if (provider.id === 'openai' || provider.settings.requires_openai_auth === true) {
      try { await command(binary, ['login', 'status'], input.workspace, nativeEnvironment(hostHome(), input.stateDirectory), stop); }
      catch { stop.throwIfAborted(); return failure('unauthorized', 'Sign in with codex login using the host CODEX_HOME, then repeat fleet setup or resume. Never paste credentials into chat.'); }
    }
    stop.throwIfAborted();
    return success(undefined);
  } catch (error) { return failure('native', error instanceof Error ? error.message : 'Cannot inspect native Codex prerequisites'); }
}
