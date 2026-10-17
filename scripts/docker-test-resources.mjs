import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resourceLimits, verifyTestResources } from './test-resources.mjs';

export function dockerManagerEnvironment(environment) {
  const selected = { ...environment };
  delete selected.DBUS_SESSION_BUS_ADDRESS;
  return selected;
}

export function dockerResourceProperties(limits) {
  return ['MemoryMax', 'MemorySwapMax', 'TasksMax'].flatMap((property, index) => {
    const value = limits[['memory.max', 'memory.swap.max', 'pids.max'][index]];
    if (typeof value !== 'string' || !/^\d+$/u.test(value) || BigInt(value) === 0n && property !== 'MemorySwapMax') throw new Error('Docker verification requires finite positive memory/task limits and finite swap');
    return [property, 't', value];
  });
}

function manager(method, signature, args) {
  return execFileSync('busctl', ['--user', 'call', 'org.freedesktop.systemd1', '/org/freedesktop/systemd1',
    'org.freedesktop.systemd1.Manager', method, signature, ...args], {
    encoding: 'utf8', timeout: 10000, env: dockerManagerEnvironment(process.env),
  });
}

export async function withDockerTestResources(run) {
  const limits = verifyTestResources();
  const driver = execFileSync('docker', ['info', '--format', '{{.CgroupVersion}} {{.CgroupDriver}}'], { encoding: 'utf8', timeout: 10000 }).trim();
  assert.equal(driver, '2 systemd', 'Docker verification requires the native cgroup v2 systemd driver');
  const name = 'app-crossfireverify' + randomUUID().replaceAll('-', '') + '.slice';
  manager('StartTransientUnit', 'ssa(sv)a(sa(sv))', [name, 'fail', '3', ...dockerResourceProperties(limits), '0']);
  let stopped = false;
  const stop = () => { if (!stopped) { stopped = true; manager('StopUnit', 'ss', [name, 'replace']); } };
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(signal, stop);
  try {
    const group = execFileSync('systemctl', ['--user', 'show', name, '--property=ControlGroup', '--value'], {
      encoding: 'utf8', timeout: 10000, env: dockerManagerEnvironment(process.env),
    }).trim();
    assert(group.startsWith('/') && group.endsWith('/' + name), 'The private Docker verification slice must exist');
    const verified = resourceLimits('/sys/fs/cgroup' + group, '/sys/fs/cgroup' + group);
    assert.deepEqual(verified, limits, 'Docker build, runtime and test descendants share the verified aggregate budget');
    console.log('Docker verification resources: ' + JSON.stringify({ cgroupParent: name, ...verified }));
    await run(name);
  } finally {
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.removeListener(signal, stop);
    stop();
  }
}
