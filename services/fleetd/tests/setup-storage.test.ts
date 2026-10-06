import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import { createRegistry } from '@ctlflow/fleetd-storage/registry';
import { generatedName } from '@ctlflow/fleetd-storage/setup';
import { prepareControllerRoot } from '@ctlflow/fleetd-storage/controller-root';
import { validateRoster } from '@ctlflow/fleetd-contracts/configuration';
import { name, type Parsed } from '@ctlflow/crossfire-contracts/schema/validation';
import { setupInput } from '@ctlflow/fleetd-contracts/setup';
import { type Result } from '@ctlflow/crossfire-kernel/result';

function value<Value>(result: Result<Value>): Value { if (!result.ok) assert.fail(result.error.message); return result.value; }
const descriptor = { schemaVersion: 1 as const, server: 'https://example.test', ownerMatrixId: '@owner:example.test',
  package: { name: '@ctlflow/fleet' as const, version: '0.1.0' }, instructions: 'Administrator instruction: disclose private paths only in owner DMs.' };

test('project setup persists one ordinary fleet and private instance state without changing the native project or its Codex files', scope => {
  const directory = mkdtempSync(join(tmpdir(), 'fleet-setup-storage-')), project = join(directory, 'Research Notes'), root = join(directory, 'controller');
  cleanup(scope, () => rmSync(directory, { recursive: true }));
  mkdirSync(project, { mode: 0o755 }); mkdirSync(join(project, '.codex'), { mode: 0o700 });
  const config = join(project, '.codex', 'config.toml'), history = join(project, '.codex', 'history.jsonl');
  writeFileSync(config, 'model = "existing-session-model"\n', { mode: 0o600 }); writeFileSync(history, 'Existing coding conversation\n', { mode: 0o600 });
  const mode = statSync(project).mode, nativeConfig = readFileSync(config), nativeHistory = readFileSync(history);
  const registry = createRegistry(root), first = value(registry.setup({ descriptor, workspace: project }));
  assert.equal(first.completed, false); assert(first.configuration.directory.startsWith(join(root, 'projects') + '/'));
  const instance = first.configuration.roster.instances[0]!;
  assert.equal(instance.workspace, project); assert(name(instance.name).ok); assert.equal(instance.key, instance.name);
  assert.equal(instance.workarea, 'agents/project/workarea/' + instance.name);
  assert.deepEqual(first.configuration.definitions.project!.options, Object.assign(Object.create(null), {
    sandbox_mode: 'danger-full-access', approval_policy: 'on-request', dangerously_bypass_approvals_and_sandbox: false,
  }));
  assert(first.configuration.definitions.project!.instructions.includes(descriptor.instructions));
  const repeated = value(registry.setup({ descriptor, workspace: project }));
  assert.equal(repeated.operationId, first.operationId); assert.equal(repeated.configuration.directory, first.configuration.directory);
  assert.deepEqual(repeated.configuration.roster, first.configuration.roster); assert.equal(repeated.configuration.digest, first.configuration.digest);
  value(registry.completeSetup(first.operationId));
  assert.equal(value(createRegistry(root).setup({ descriptor, workspace: project })).completed, true);
  assert.equal(statSync(project).mode, mode); assert.deepEqual(readFileSync(config), nativeConfig); assert.deepEqual(readFileSync(history), nativeHistory);
  assert.equal(statSync(first.configuration.directory).mode & 0o777, 0o700);
});

test('only generated names are normalized; exact explicit names, authority and native workspace are validated', scope => {
  const directory = mkdtempSync(join(tmpdir(), 'fleet-setup-config-')), root = join(directory, 'controller'), role = join(directory, 'agents', 'reviewer');
  cleanup(scope, () => rmSync(directory, { recursive: true }));
  mkdirSync(role, { recursive: true, mode: 0o700 });
  writeFileSync(join(role, 'agent.toml'), 'name = "Reviewer"\nruntime = "codex"\n[runtime_options]\nmodel = "native-model"\n', { mode: 0o600 });
  writeFileSync(join(role, 'AGENTS.md'), 'Original role instructions.', { mode: 0o600 });
  const file = join(directory, 'runtime.toml');
  const roster = 'fleet = "reviewers"\n[coordination]\nadapter = "crossfire"\nserver = "https://example.test"\nowner = "@owner:example.test"\n'
    + '[[instances]]\nkey = "bea"\nname = "bea"\ndefinition = "reviewer"\nworkarea = "agents/reviewer/workarea/bea"\n';
  writeFileSync(file, roster, { mode: 0o600 });
  const registry = createRegistry(root), input = { descriptor, workspace: directory, configuration: file };
  const configured = value(registry.setup(input));
  assert.equal(configured.configuration.directory, directory); assert.equal(configured.configuration.roster.instances[0]!.workspace, undefined);
  assert.equal(configured.configuration.definitions.reviewer!.options.model, 'native-model'); assert.equal(readFileSync(file, 'utf8'), roster);
  assert.equal(registry.setup({ ...input, descriptor: { ...descriptor, ownerMatrixId: '@other:example.test' } }).ok, false);
  writeFileSync(file, roster.replace('name = "bea"', 'name = "Bea"'), { mode: 0o600 });
  assert.equal(registry.setup(input).ok, false, 'Explicit names are rejected, never normalized');
  const normalized = generatedName('123 Credit / Research (Q4)', 'abcdef0123456789');
  assert(name(normalized).ok); assert.equal(normalized.endsWith('-abcdef012345'), true);
});

test('setup retries incomplete operation identities only and never replaces persisted authority or administrator instructions silently', scope => {
  const directory = mkdtempSync(join(tmpdir(), 'fleet-setup-retry-')), project = join(directory, 'project');
  cleanup(scope, () => rmSync(directory, { recursive: true })); mkdirSync(project, { mode: 0o700 });
  const registry = createRegistry(join(directory, 'controller')), input: Parsed<typeof setupInput> = { descriptor, workspace: project };
  const first = value(registry.setup(input)), replacement = randomUUID();
  value(registry.retrySetup(first.operationId, replacement));
  assert.equal(value(registry.setup(input)).operationId, replacement);
  const repeated = value(registry.setup({ ...input, descriptor: { ...descriptor, instructions: 'Different instructions require an explicit configuration change.' } }));
  assert.equal(repeated.configuration.digest, first.configuration.digest);
  value(registry.completeSetup(replacement)); assert.equal(registry.retrySetup(replacement, randomUUID()).ok, false);
});

test('workspace override follows the one roster model and refuses nonexistent or symbolic native directories', scope => {
  const directory = mkdtempSync(join(tmpdir(), 'fleet-workspace-boundary-')), project = join(directory, 'project'), alias = join(directory, 'alias');
  cleanup(scope, () => rmSync(directory, { recursive: true })); mkdirSync(project, { mode: 0o700 }); symlinkSync(project, alias);
  const registry = createRegistry(join(directory, 'controller'));
  assert.equal(registry.setup({ descriptor, workspace: alias }).ok, false);
  assert.equal(registry.setup({ descriptor, workspace: join(directory, 'absent') }).ok, false);
  const roster = { fleet: 'test', coordination: { adapter: 'crossfire', server: descriptor.server, owner: descriptor.ownerMatrixId },
    instances: [{ key: 'one', name: 'one', definition: 'project', workarea: 'agents/project/workarea/one', workspace: project }] };
  assert(validateRoster(roster).ok);
  for (const workspace of ['relative', project + '/../project', project + '/', project + '/./nested']) {
    assert.equal(validateRoster({ ...roster, instances: [{ ...roster.instances[0], workspace }] }).ok, false);
  }
});

test('controller root validation never chmods a user project to private and rejects symlink roots', scope => {
  const directory = mkdtempSync(join(tmpdir(), 'fleet-controller-root-')), project = join(directory, 'project'), alias = join(directory, 'alias');
  cleanup(scope, () => rmSync(directory, { recursive: true })); mkdirSync(project, { mode: 0o755 }); symlinkSync(project, alias);
  assert.throws(() => prepareControllerRoot(project), /must already be a private/u); assert.equal(statSync(project).mode & 0o777, 0o755);
  assert.throws(() => prepareControllerRoot(alias), /must already be a private/u);
  const root = join(directory, 'private', 'controller'); assert.equal(prepareControllerRoot(root), root); assert.equal(statSync(root).mode & 0o777, 0o700);
});
