import assert from 'node:assert/strict';
import test from 'node:test';
import { definition, parseToml } from '@ctlflow/fleetd-contracts/configuration';

test('large dot-free TOML parses completely inside the existing document bound', () => {
  const count = 65_536;
  const source = 'name = "Analyst"\nruntime = "codex"\n[runtime_options]\n'
    + Array.from({ length: count }, (_unused, index) => 'option' + index + ' = 1\n').join('');
  assert(Buffer.byteLength(source) < 1024 * 1024);
  const result = parseToml(source, definition);
  assert(result.ok);
  assert.equal(Object.keys(result.value.runtime_options).length, count);
  assert.equal(result.value.runtime_options.option0, 1);
  assert.equal(result.value.runtime_options['option' + (count - 1)], 1);
  assert.deepEqual(parseToml(source + ' '.repeat(1024 * 1024), definition),
    { ok: false, error: { code: 'limit', message: 'TOML exceeds 1 MiB' } });
});

test('the patched key parser retains quoted and dotted keys and rejects malformed declarations', () => {
  const source = 'name = "Analyst"\nruntime = "codex"\n[runtime_options]\n'
    + '"model.with.dots" = "fixture"\nprovider.model = "nested"\n\'quoted key\' = true\n';
  const result = parseToml(source, definition);
  assert(result.ok);
  assert.deepEqual(result.value.runtime_options, Object.assign(Object.create(null), {
    'model.with.dots': 'fixture', provider: Object.assign(Object.create(null), { model: 'nested' }), 'quoted key': true,
  }));
  for (const suffix of ['duplicate = 1\nduplicate = 2', 'provider..model = "bad"',
    '"key" extra = 1', 'bare\nkey = 1', '= 1']) {
    assert.equal(parseToml('name = "Analyst"\nruntime = "codex"\n[runtime_options]\n' + suffix, definition).ok,
      false, suffix);
  }
});

test('TOML table keys remain data without inheriting or modifying object prototypes', () => {
  const result = parseToml('name = "Analyst"\nruntime = "codex"\n[runtime_options]\n'
    + 'constructor = "native setting"\n__proto__.crossfireProbe = true\n', definition);
  assert(result.ok);
  assert.deepEqual(result.value.runtime_options, Object.assign(Object.create(null), {
    constructor: 'native setting', ['__proto__']: Object.assign(Object.create(null), { crossfireProbe: true }),
  }));
  assert.equal('crossfireProbe' in Object.prototype, false);
});
