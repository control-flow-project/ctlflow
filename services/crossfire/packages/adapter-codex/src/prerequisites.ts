import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stringify } from 'smol-toml';
import { failure, success, type Result } from '@ctlflow/crossfire-kernel/result';
import { effectiveProvider, hostHome, nativeConfiguration, nativeDirectories, nativeEnvironment, prepareHome } from './home.js';
import { ownedOptions, ownedQuestionCapability, ownedVersion } from './owned-options.js';
import { inspectInstructionCapability } from './capability.js';
import { startProcess } from './owned-process.js';
import { codexProtocol } from './protocol.js';
import { admitCodex } from './admission.js';
import { codexClientVersion } from './version.js';
import { errorCode } from '@ctlflow/crossfire-contracts/rest/envelope';

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
    const inspectionHome = mkdtempSync(join(input.stateDirectory, '.codex-inspection-'));
    try {
      writeFileSync(join(inspectionHome, 'config.toml'), stringify(nativeConfiguration(home)), { mode: 0o600 });
      const native = await startProcess(inspectionHome, input.workspace, input.stateDirectory, 'crossfire-inspection', stop, binary,
        parsed.value.options.features?.default_mode_request_user_input === true);
      let protocol: ReturnType<typeof codexProtocol> | undefined;
      try {
        protocol = codexProtocol({ endpoint: native.endpoint, token: native.token, timeoutMs: 10000, event: () => {},
          approval: async () => { throw new Error('Capability inspection cannot answer native requests'); } }, AbortSignal.any([stop, native.signal]));
        await protocol.request('initialize', { clientInfo: { name: 'crossfire-inspection', version: codexClientVersion }, capabilities: { experimentalApi: true } });
        protocol.notify('initialized');
        const admitted = await admitCodex(protocol.request, parsed.value.options);
        return admitted.ok ? success(undefined) : admitted;
      } finally { try { if (protocol) { protocol.close(); await protocol.closed; } } finally { await native.close(); } }
    } finally { rmSync(inspectionHome, { recursive: true, force: true }); }
  } catch (error) {
    const parsed = errorCode(error && typeof error === 'object' && 'code' in error ? error.code : undefined);
    return failure(parsed.ok ? parsed.value : 'native', error instanceof Error ? error.message : 'Cannot inspect native Codex prerequisites');
  }
}
