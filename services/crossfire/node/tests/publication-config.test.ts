import test from 'node:test';
import assert from 'node:assert/strict';
import { config, publicationBudget } from '../apps/server/src/config.js';
import { value } from './support/application.js';

test('publication origin and aggregate budgets are explicit, finite and validated at the configuration boundary', () => {
  const input = { instance: 'tests', serverName: 'crossfire.example', administrator: '@admin:crossfire.example', publicOrigin: 'https://crossfire.example',
    contentOrigin: 'https://content.crossfire.example', matrixOrigin: 'http://127.0.0.1:6167', jwtSecret: 'j'.repeat(43), registrationSecret: 'r'.repeat(43) };
  const checked = value(config(input));
  assert.equal(checked.contentOrigin, input.contentOrigin);
  assert.deepEqual(checked.publicationBudget, { instanceBytes: 1024 ** 3, agentBytes: 128 * 1024 ** 2, instanceCount: 4096, agentCount: 128, uploads: 8 });
  const { contentOrigin, ...missing } = input; assert.equal(config(missing).ok, false); assert(contentOrigin);
  for (const origin of ['https://crossfire.example', 'https://crossfire.example:8443', 'http://content.crossfire.example', 'https://content.crossfire.example/path', 'https://name:secret@content.crossfire.example'])
    assert.equal(config({ ...input, contentOrigin: origin }).ok, false, origin);
  assert.equal(config({ ...input, contentOrigin: 'https://matrix.crossfire.example:8443', matrixOrigin: 'https://matrix.crossfire.example' }).ok, false);
  const budget = checked.publicationBudget!;
  for (const invalid of [{ ...budget, uploads: 33 }, { ...budget, agentBytes: budget.instanceBytes + 1 }, { ...budget, instanceBytes: 1024 ** 4 + 1 },
    { ...budget, agentCount: budget.instanceCount + 1 }, { ...budget, instanceCount: 100001 }, { ...budget, uploads: 0 }, { ...budget, uploads: 1.5 }, { ...budget, uploads: '8' }, { ...budget, extra: true }])
    assert.equal(publicationBudget(invalid).ok, false);
  assert.equal(config({ ...input, publicationBudget: { ...budget, uploads: 1 } }).ok, true);
});
