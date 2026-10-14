import assert from 'node:assert/strict';
import test from 'node:test';
import { fakeCodex, matrixFixture } from '../scripts/test-support/listener.js';
import { builtRelease } from '../scripts/test-support/release.js';
import { updatedRelease } from './release-fixture.js';
import { updateNotice } from '@ctlflow/crossfire-contracts/release';
import { listen } from '@ctlflow/crossfire-adapter-crossfire/listener';

test('controller listener admission rejects superseded artifacts before native startup and preserves update consent', async scope => {
  const native = await fakeCodex(scope), fixture = await matrixFixture(scope, native.directory);
  const installed = builtRelease().release;
  const current = updatedRelease(installed, 'README.md', '# Updated instructions\n');
  fixture.reporting.current = current.manifest;
  const notice = updateNotice(fixture.settings.homeserver, installed.manifest.release, current.manifest, installed.manifest.artifacts['SKILL.md'].sha256);
  assert.match(notice, /skill content is unchanged/u);
  assert.match(notice, /consent before updating the owning fleet controller/u);
  assert.match(notice, /Never start a competing listener/u);
  assert.match(notice, /Do not enroll again/u);
  await assert.rejects(listen({ ...fixture, runtime: native.runtime, reconcileMs: 1000, pollMs: 100, debounceMs: 0, limit: 20 }, new AbortController().signal), /Crossfire update required/u);
  assert.equal(native.requests().length, 0);
  assert.equal(fixture.host.size(), 0, 'Failed admission releases the controller host binding');
});
