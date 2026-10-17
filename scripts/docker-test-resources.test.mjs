import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { dockerResourceProperties } from './docker-test-resources.mjs';
import { userManagerEnvironment, verifyTestResources } from './test-resources.mjs';

test('only manager commands reconnect to the native user bus; browser inheritance stays disabled', () => {
  const browser = { DBUS_SESSION_BUS_ADDRESS: 'unix:path=/dev/null', XDG_RUNTIME_DIR: '/run/user/1001', PATH: '/bin' };
  assert.deepEqual(userManagerEnvironment(browser), { XDG_RUNTIME_DIR: '/run/user/1001', PATH: '/bin' });
  assert.equal(browser.DBUS_SESSION_BUS_ADDRESS, 'unix:path=/dev/null');
});

test('the actual manager launches a bounded worker without inheriting the disabled browser bus', () => {
  const limits = verifyTestResources();
  const script = 'import {verifyTestResources} from ' + JSON.stringify(new URL('./test-resources.mjs', import.meta.url).href)
    + '; console.log(JSON.stringify(verifyTestResources()));';
  const output = execFileSync('systemd-run', ['--user', '--scope', '--quiet',
    '--property=MemoryMax=' + limits['memory.max'], '--property=MemorySwapMax=' + limits['memory.swap.max'], '--property=TasksMax=' + limits['pids.max'],
    process.execPath, '--input-type=module', '-e', script], { env: userManagerEnvironment(process.env), encoding: 'utf8', timeout: 15000 });
  assert.deepEqual(JSON.parse(output), limits);
  assert.equal(process.env.DBUS_SESSION_BUS_ADDRESS, 'unix:path=/dev/null');
});

test('Docker verification carries finite aggregate memory, swap and task budgets into its exact slice', () => {
  assert.deepEqual(dockerResourceProperties({ 'memory.max': '8589934592', 'memory.swap.max': '0', 'pids.max': '1024' }),
    ['MemoryMax', 't', '8589934592', 'MemorySwapMax', 't', '0', 'TasksMax', 't', '1024']);
});

test('Docker verification rejects missing, unlimited, negative and zero memory/task budgets', () => {
  for (const key of ['memory.max', 'memory.swap.max', 'pids.max']) {
    for (const value of [undefined, 1, 'max', '-1', '1.5', ...(key === 'memory.swap.max' ? [] : ['0'])]) {
      assert.throws(() => dockerResourceProperties({ 'memory.max': '8589934592', 'memory.swap.max': '0', 'pids.max': '1024', [key]: value }), /finite/u);
    }
  }
});
