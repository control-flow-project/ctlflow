import assert from 'node:assert/strict';
import test from 'node:test';
import { admitCodex } from '@ctlflow/crossfire-adapter-codex/admission';

const model = (name: string, efforts = ['low', 'medium', 'high', 'xhigh', 'max'], isDefault = true) => ({ model: name, isDefault,
  defaultReasoningEffort: efforts[0], supportedReasoningEfforts: efforts.map(reasoningEffort => ({ reasoningEffort })) });

test('native admission resolves exact effective defaults and all advertised instance efforts without starting a thread', async () => {
  const methods: string[] = [];
  const request = async (method: string) => {
    methods.push(method);
    if (method === 'config/read') return { config: { model: 'selected', model_reasoning_effort: 'high' } };
    assert.equal(method, 'model/list'); return { data: [model('selected'), model('other', ['medium'], false)], nextCursor: null };
  };
  assert.deepEqual(await admitCodex(request, {}), { ok: true, value: { model: 'selected', effort: 'high' } });
  for (const effort of ['low', 'medium', 'high', 'xhigh', 'max']) {
    assert.deepEqual(await admitCodex(request, { model_reasoning_effort: effort }), { ok: true, value: { model: 'selected', effort } });
  }
  for (const options of [{ model: 'absent' }, { model: 'other' }, { model_reasoning_effort: 'ultra' }]) {
    const result = await admitCodex(request, options); assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, 'invalid');
  }
  assert(methods.every(method => ['config/read', 'model/list'].includes(method)));
});

test('native admission uses catalog defaults, bounded pagination and rejects ambiguous or invalid catalogs', async () => {
  const pages = [{ data: [model('first', ['medium'], false)], nextCursor: 'next' }, { data: [model('selected', ['high'])], nextCursor: null }];
  assert.deepEqual(await admitCodex(async (method, params) => {
    if (method === 'config/read') return { config: { model: null, model_reasoning_effort: null } };
    const page = pages.shift(); assert(page);
    if (page.nextCursor === null) assert.equal((params as { cursor: string }).cursor, 'next');
    return page;
  }, {}), { ok: true, value: { model: 'selected', effort: 'high' } });
  for (const data of [[], [model('first'), model('second')], [model('duplicate'), model('duplicate')],
    [{ ...model('broken'), defaultReasoningEffort: 'unavailable' }], [null]]) {
    assert.equal((await admitCodex(async method => method === 'config/read' ? { config: {} } : { data, nextCursor: null }, {})).ok, false);
  }
  assert.equal((await admitCodex(async method => method === 'config/read' ? { config: {} } : { data: [], nextCursor: 'no-progress' }, {})).ok, false);
});
