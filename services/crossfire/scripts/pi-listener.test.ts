import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import { fakeCodex, matrixFixture } from './test-support/listener.js';
import { builtClient } from './test-support/release.js';

const execute = promisify(execFile);

test('Pi listener refuses an absent native attachment before Matrix network use', async scope => {
  const native = await fakeCodex(scope);
  const fixture = await matrixFixture(scope, native.directory);
  const args = [builtClient(), '--project', fixture.workspace, '--profile', 'watson', 'agent', 'listen', '--runtime', 'pi'];
  await assert.rejects(execute(process.execPath, args, { env: { ...fixture.env, CROSSFIRE_PI_CONNECTION: '' } }), /Pi native connection is not ready/);
  assert.equal(fixture.requests.length, 0);
  assert.equal(existsSync(fixture.cursorFile), false);
});
