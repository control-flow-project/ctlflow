import assert from 'node:assert/strict';
import test from 'node:test';
import { execute } from './rust-process.mjs';

test('Rust verification never mixes native preparation warnings with JSON output', async () => {
  const output = await execute(process.execPath, ['-e', 'console.error("npm warn deprecated dependency");console.log(JSON.stringify({binary:"/native/pi"}));']);
  assert.deepEqual(JSON.parse(output), { binary: '/native/pi' });
  const values = [];
  await execute(process.execPath, ['-e', 'console.error("compiler warning");process.stdout.write("{\\"value\\":1}\\n{\\"value\\":2}");'], { line: text => values.push(JSON.parse(text)) });
  assert.deepEqual(values, [{ value: 1 }, { value: 2 }]);
});
test('native command failures retain bounded separate diagnostics and deadlines remain enforced', async () => {
  await assert.rejects(execute(process.execPath, ['-e', 'console.log("native output");console.error("native failure");process.exitCode=17;']), /stdout:\nnative output\n\nstderr:\nnative failure/u);
  await assert.rejects(execute(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeout: 100 }), /timeout/u);
  await assert.rejects(execute(process.execPath, ['-e', 'process.stdout.write("x".repeat(2097153));setInterval(()=>{},1000);'], { line: JSON.parse }), /resource bound/u);
  for (const timeout of [0, -1, NaN, Infinity, 0.5]) assert.throws(() => execute('invalid', [], { timeout }), /bounded positive/u);
});
