import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'smol-toml';
import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import { codexRuntime } from '@ctlflow/crossfire-adapter-codex/owned';
import { nativeConfiguration, prepareHome } from '@ctlflow/crossfire-adapter-codex/home';
import { nativeEnvironment } from '@ctlflow/crossfire-adapter-codex/home';
import { refreshAuthentication } from '@ctlflow/crossfire-adapter-codex/authentication';
import { nativeModels } from '@ctlflow/crossfire-test-support/native-models';

function fixture(scope: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'crossfire-native-prerequisites-'));
  cleanup(scope, () => rmSync(directory, { recursive: true, force: true }));
  const source = join(directory, 'source'), stateDirectory = join(directory, 'state'), workspace = join(directory, 'project');
  for (const folder of [source, stateDirectory, workspace]) mkdirSync(folder, { mode: 0o700 });
  const previous = process.env.CODEX_HOME;
  process.env.CODEX_HOME = source;
  cleanup(scope, () => { if (previous === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = previous; });
  return { directory, source, stateDirectory, workspace };
}

test('managed homes preserve native model/provider defaults and refresh private login, not history, trust or approval settings', scope => {
  const { source, stateDirectory, workspace } = fixture(scope);
  writeFileSync(join(source, 'auth.json'), '{"auth_mode":"apikey","OPENAI_API_KEY":"fixture-only"}', { mode: 0o600 });
  writeFileSync(join(source, 'config.toml'), `model = "configured-model"
model_reasoning_effort = "medium"
model_provider = "fixture"
approval_policy = "never"
sandbox_mode = "danger-full-access"
developer_instructions = "Do not import these instructions"
[model_providers.fixture]
name = "Native provider"
base_url = "http://127.0.0.1:1/v1"
wire_api = "responses"
requires_openai_auth = false
[projects.${JSON.stringify(workspace)}]
trust_level = "trusted"
`, { mode: 0o600 });
  mkdirSync(join(source, 'sessions')); writeFileSync(join(source, 'sessions', 'existing-history'), 'private existing terminal history');
  mkdirSync(join(workspace, '.codex')); writeFileSync(join(workspace, '.codex', 'keep'), 'Existing native project state');
  const home = prepareHome(stateDirectory), configuration = nativeConfiguration(home);
  assert.equal(existsSync(join(home, 'auth.json')), false, 'Configuration preparation does not refresh credentials beneath a running engine');
  assert.equal(refreshAuthentication(home).ok, true);
  assert.equal(home, join(stateDirectory, '.codex'));
  assert.equal(configuration.model, 'configured-model'); assert.equal(configuration.model_reasoning_effort, 'medium');
  assert.equal(configuration.model_provider, 'fixture');
  assert.deepEqual(configuration.model_providers, parse(readFileSync(join(source, 'config.toml'), 'utf8')).model_providers);
  for (const key of ['approval_policy', 'sandbox_mode', 'projects', 'developer_instructions']) assert.equal(configuration[key], undefined);
  assert.deepEqual(readFileSync(join(home, 'auth.json')), readFileSync(join(source, 'auth.json')));
  assert.deepEqual(readdirSync(home).sort(), ['auth.json', 'config.toml']);
  assert.equal(statSync(join(home, 'auth.json')).mode & 0o077, 0);
  assert.deepEqual(readdirSync(join(workspace, '.codex')), ['keep']);
  writeFileSync(join(source, 'config.toml'), 'model = "changed-source"');
  assert.equal(nativeConfiguration(prepareHome(stateDirectory)).model, 'configured-model', 'Native managed configuration remains authoritative after initial setup');
});

test('native profile model defaults remain selected without inheriting profile approval bypasses', scope => {
  const { source, stateDirectory } = fixture(scope);
  writeFileSync(join(source, 'config.toml'), `profile = "selected"
model = "base-model"
[profiles.selected]
model = "profile-model"
model_reasoning_effort = "high"
approval_policy = "never"
[profiles.other]
model = "unselected"
`, { mode: 0o600 });
  const configuration = nativeConfiguration(prepareHome(stateDirectory));
  assert.equal(configuration.profile, 'selected');
  assert.deepEqual(configuration.profiles, Object.assign(Object.create(null), {
    selected: Object.assign(Object.create(null), { model: 'profile-model', model_reasoning_effort: 'high' }),
  }));
});

test('unsafe configuration/login files cannot seed private managed runtime state', scope => {
  const { source, stateDirectory, directory } = fixture(scope);
  const config = join(source, 'config.toml'); writeFileSync(config, 'model = "safe"', { mode: 0o600 });
  chmodSync(config, 0o666); assert.throws(() => prepareHome(stateDirectory), /bounded TOML/u);
  chmodSync(config, 0o600); rmSync(config); symlinkSync(join(directory, 'absent'), config);
  assert.throws(() => prepareHome(stateDirectory), /bounded TOML/u);
  rmSync(config); writeFileSync(config, 'model = "safe"', { mode: 0o600 });
  writeFileSync(join(source, 'auth.json'), 'fixture-secret', { mode: 0o644 });
  assert.equal(refreshAuthentication(prepareHome(stateDirectory)).ok, false);
  assert.equal(existsSync(join(stateDirectory, '.codex', 'auth.json')), false);
});

test('prerequisite inspection checks the current host login without overwriting the managed login', async scope => {
  const { source, stateDirectory, workspace } = fixture(scope);
  const home = prepareHome(stateDirectory), old = '{"auth_mode":"apikey","OPENAI_API_KEY":"old-fixture-only"}';
  writeFileSync(join(home, 'auth.json'), old, { mode: 0o600 });
  writeFileSync(join(source, 'auth.json'), '{"auth_mode":"apikey","OPENAI_API_KEY":"new-fixture-only"}', { mode: 0o600 });
  const adapter = codexRuntime(process.env.CROSSFIRE_TEST_CODEX ?? 'codex');
  assert.deepEqual(await adapter.inspect({ workspace, stateDirectory, options: {} }, new AbortController().signal), { ok: true, value: undefined });
  assert.equal(readFileSync(join(home, 'auth.json'), 'utf8'), old);
  rmSync(join(source, 'auth.json'));
  const result = await adapter.inspect({ workspace, stateDirectory, options: {} }, new AbortController().signal);
  assert.equal(result.ok, false, 'An old managed login cannot pass host-login preflight');
  if (!result.ok) { assert.equal(result.error.code, 'unauthorized'); assert.match(result.error.message, /host CODEX_HOME/u); }
  assert.equal(readFileSync(join(home, 'auth.json'), 'utf8'), old);
});

test('native prerequisite inspection validates configured inert providers without sessions, adoption or model calls', async scope => {
  const { source, stateDirectory, workspace } = fixture(scope);
  const catalog = join(source, 'models.json'); writeFileSync(catalog, JSON.stringify(nativeModels()), { mode: 0o600 });
  writeFileSync(join(source, 'config.toml'), `model = "fixture-model"
model_catalog_json = ${JSON.stringify(catalog)}
model_provider = "fixture"
[model_providers.fixture]
name = "Inert prerequisite fixture"
base_url = "http://127.0.0.1:1/v1"
wire_api = "responses"
requires_openai_auth = false
`, { mode: 0o600 });
  const adapter = codexRuntime(process.env.CROSSFIRE_TEST_CODEX ?? 'codex');
  const result = await adapter.inspect({ workspace, stateDirectory, options: {} }, new AbortController().signal);
  assert.deepEqual(result, { ok: true, value: undefined });
  assert.equal(existsSync(join(stateDirectory, '.codex', 'crossfire-context-registry.json')), false);
  assert.equal(existsSync(join(workspace, '.codex')), false);
  assert.equal(existsSync(join(stateDirectory, '.codex', 'sessions')), false);
  assert.deepEqual(await adapter.savedContexts({ workspace, stateDirectory }), { ok: true, value: [] });
  const unavailable = await adapter.inspect({ workspace, stateDirectory, options: { model: 'unavailable-model' } }, new AbortController().signal);
  assert.equal(unavailable.ok, false);
  if (!unavailable.ok) assert.equal(unavailable.error.code, 'invalid');
  assert.equal(existsSync(join(stateDirectory, '.codex', 'sessions')), false, 'Capability refusal starts no native conversation');
  const environment = nativeEnvironment(join(stateDirectory, '.codex'), stateDirectory, 'managed-agent');
  assert.equal(environment.CROSSFIRE_PROJECT, stateDirectory); assert.equal(environment.CROSSFIRE_AGENT_NAME, 'managed-agent');
  assert.equal(environment.CODEX_THREAD_ID, undefined);
});

test('native prerequisite failures are actionable and do not enroll, start histories or disclose keys', async scope => {
  const { source, stateDirectory, workspace } = fixture(scope);
  writeFileSync(join(source, 'config.toml'), `model_provider = "fixture"
[model_providers.fixture]
name = "Credential fixture"
base_url = "http://127.0.0.1:1/v1"
wire_api = "responses"
env_key = "CROSSFIRE_MISSING_FIXTURE_PROVIDER_KEY"
requires_openai_auth = false
`, { mode: 0o600 });
  const adapter = codexRuntime(process.env.CROSSFIRE_TEST_CODEX ?? 'codex');
  const missingKey = await adapter.inspect({ workspace, stateDirectory, options: {} }, new AbortController().signal);
  assert.equal(missingKey.ok, false); if (!missingKey.ok) assert.match(missingKey.error.message, /environment variable/u);
  const invalid = await adapter.inspect({ workspace, stateDirectory, options: { adoptSession: 'existing' } }, new AbortController().signal);
  assert.equal(invalid.ok, false);
  const cancelled = new AbortController(); cancelled.abort(new Error('Cancelled prerequisite inspection'));
  assert.equal((await adapter.inspect({ workspace, stateDirectory, options: {} }, cancelled.signal)).ok, false);
  const noBinary = await codexRuntime('/missing-native-codex').inspect({ workspace, stateDirectory, options: {} }, new AbortController().signal);
  assert.equal(noBinary.ok, false); if (!noBinary.ok) assert.match(noBinary.error.message, /prerequisite command/u);
  assert.equal(existsSync(join(stateDirectory, '.codex', 'crossfire-context-registry.json')), false);
});
