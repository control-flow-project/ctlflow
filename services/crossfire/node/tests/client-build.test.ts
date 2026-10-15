import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildAgentArtifacts } from '@ctlflow/crossfire-agent-tools/build';
import { ARTIFACTS } from '@ctlflow/crossfire-contracts/release';

test('private tools build one self-contained verified release without standalone lifecycle or other runtime artifacts', async scope => {
  const directory = mkdtempSync(join(tmpdir(), 'crossfire-agent-tools-'));
  scope.after(() => rmSync(directory, { recursive: true }));
  const release = await buildAgentArtifacts(directory, '0.1.0');
  assert.deepEqual(readdirSync(directory).sort(), ['manifest.json', ...ARTIFACTS].sort());
  assert.deepEqual(ARTIFACTS, ['README.md', 'SKILL.md', 'crossfire-client.mjs', 'matrix-spec-LICENSE.txt']);
  const client = join(directory, 'crossfire-client.mjs');
  const help = JSON.parse(execFileSync(process.execPath, [client, '--help'], { cwd: tmpdir(), encoding: 'utf8' })) as { agent: Record<string, unknown>; room: Record<string, unknown> };
  assert.deepEqual(Object.keys(help.agent).sort(), ['directory', 'history', 'read', 'status', 'test']);
  assert(Object.hasOwn(help.room, 'invite-agent') && Object.hasOwn(help.room, 'remove-agent'));
  for (const command of ['connect', 'disconnect', 'listen']) assert.throws(() => execFileSync(process.execPath, [client, 'agent', command], { stdio: 'pipe' }), /Unknown command/u);
  assert.throws(() => execFileSync(process.execPath, [client, 'runtime', 'claude-hook'], { stdio: 'pipe' }));
  assert.throws(() => execFileSync(process.execPath, [client, '--runtime', 'pi', 'agent', 'test'], { stdio: 'pipe' }));
  const second = join(directory, 'second');
  const repeated = await buildAgentArtifacts(second, '0.1.0');
  assert.equal(repeated.manifest.release, release.manifest.release, 'The same artifact builder produces canonical bytes for both public products and HTTP inspection');
  assert.deepEqual(readFileSync(join(second, 'crossfire-client.mjs')), readFileSync(client));
  await assert.rejects(buildAgentArtifacts(directory, '0.1.0'), /immutable/u);
});
