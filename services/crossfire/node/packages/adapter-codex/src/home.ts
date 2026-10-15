import { constants, openSync, fstatSync, closeSync, readSync, lstatSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { parse, stringify, type TomlTable } from 'smol-toml';
import { privateDir } from '@ctlflow/crossfire-adapter-filesystem/index';

const modelKeys = ['model', 'model_provider', 'model_reasoning_effort', 'model_reasoning_summary', 'model_verbosity',
  'model_context_window', 'model_auto_compact_token_limit', 'model_auto_compact_token_limit_scope', 'model_supports_reasoning_summaries',
  'model_catalog_json', 'openai_base_url', 'chatgpt_base_url'];

export function nativeEnvironment(home: string, stateDirectory: string, profile?: string): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { ...process.env, CODEX_HOME: home, CROSSFIRE_PROJECT: stateDirectory };
  delete environment.CODEX_THREAD_ID;
  delete environment.CROSSFIRE_AGENT_NAME;
  if (profile !== undefined) environment.CROSSFIRE_AGENT_NAME = profile;
  return environment;
}

export function metadataExists(file: string): boolean {
  try { lstatSync(file); return true; }
  catch (error) { if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return false; throw error; }
}

export function nativeDirectories(input: { workspace: string; stateDirectory: string }): void {
  if (!['linux', 'darwin'].includes(process.platform) || !process.getuid) throw new Error('Managed Codex requires Linux or macOS native ownership primitives');
  for (const directory of [input.workspace, input.stateDirectory]) {
    if (!isAbsolute(directory) || resolve(directory) !== realpathSync(directory) || !lstatSync(directory).isDirectory()) {
      throw new Error('Use exact existing native workspace and private state directories, without symbolic links');
    }
  }
  const state = lstatSync(input.stateDirectory);
  if (state.uid !== process.getuid() || state.mode & 0o077) throw new Error('Managed runtime state must be an owned private directory');
}

function configurationBytes(file: string): Buffer {
  if (realpathSync(dirname(file)) !== resolve(dirname(file))) throw new Error('Native configuration cannot traverse symbolic link directories');
  const descriptor = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = fstatSync(descriptor);
    if (!info.isFile() || info.uid !== process.getuid!() || info.mode & 0o022 || info.size > 1024 * 1024) throw new Error('Native configuration must be an owned, bounded regular file without shared write access');
    const bytes = Buffer.alloc(info.size + 1);
    let size = 0;
    while (size < bytes.length) {
      const count = readSync(descriptor, bytes, size, bytes.length - size, null);
      if (!count) break;
      size += count;
    }
    if (size !== info.size || fstatSync(descriptor).size !== info.size) throw new Error('Native configuration changed during its bounded read');
    return bytes.subarray(0, size);
  } finally { closeSync(descriptor); }
}

export function nativeConfiguration(home: string): TomlTable {
  const file = join(home, 'config.toml');
  if (!metadataExists(file)) return {};
  try { return parse(configurationBytes(file).toString('utf8')); }
  catch { throw new Error('Cannot read the owned native configuration as bounded TOML'); }
}

function table(value: unknown): value is TomlTable {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function modelDefaults(configuration: TomlTable): TomlTable {
  const selected: TomlTable = {};
  for (const key of modelKeys) if (configuration[key] !== undefined) selected[key] = configuration[key];
  return selected;
}

export function effectiveProvider(configuration: TomlTable): { id: string; settings: TomlTable } {
  const profiles = configuration.profiles;
  const profile = typeof configuration.profile === 'string' && table(profiles) ? profiles[configuration.profile] : undefined;
  const selected = table(profile) ? { ...configuration, ...profile } : configuration;
  const id = selected.model_provider ?? 'openai';
  if (typeof id !== 'string' || !id) throw new Error('The native model provider must have an exact configured identity');
  const providers = selected.model_providers;
  const settings = table(providers) ? providers[id] : undefined;
  if (!['openai', 'ollama', 'lmstudio'].includes(id) && !table(settings)) throw new Error('The selected native model provider has no configured definition');
  return { id, settings: table(settings) ? settings : {} };
}

export function hostHome(): string {
  return process.env.CODEX_HOME ?? join(homedir(), '.codex');
}

export function prepareHome(stateDirectory: string): string {
  const home = privateDir(join(stateDirectory, '.codex'));
  const source = hostHome();
  if (!metadataExists(join(home, 'config.toml'))) {
    const configuration = nativeConfiguration(source), selected = modelDefaults(configuration);
    for (const key of ['model_providers', 'cli_auth_credentials_store']) if (configuration[key] !== undefined) selected[key] = configuration[key];
    if (configuration.profile !== undefined) {
      const profile = configuration.profile, profiles = configuration.profiles;
      if (typeof profile !== 'string' || !table(profiles) || !table(profiles[profile])) throw new Error('The selected native configuration profile is not defined');
      selected.profile = profile;
      selected.profiles = { [profile]: modelDefaults(profiles[profile]) };
    }
    effectiveProvider(selected);
    writeFileSync(join(home, 'config.toml'), stringify(selected), { flag: 'wx', mode: 0o600 });
  }
  return home;
}
