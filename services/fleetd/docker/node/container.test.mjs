import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import test from 'node:test';
import { withDockerTestResources } from '../../../../scripts/docker-test-resources.mjs';

const execute = promisify(execFile);
const docker = async arguments_ => (await execute('docker', arguments_, { encoding: 'utf8', timeout: 120000, maxBuffer: 1024 * 1024 })).stdout;
const root = '/home/node/.ctlflow/controller';

test('Node fleet container retains private credentials and stopped registry across restart', { timeout: 180000 }, async scope => {
  assert.match(process.env.CTLFLOW_FLEET_IMAGE ?? '', /^sha256:[a-f0-9]{64}$/u);
  await withDockerTestResources(async cgroupParent => {
    const name = 'ctlflow-fleet-test-' + randomUUID().slice(0, 8), volume = name + '-home';
    const fleet = arguments_ => docker(['exec', name, 'fleet', '--root', root, ...arguments_]);
    const node = text => docker(['exec', name, 'node', '--input-type=module', '-e', text]);
    async function ready() {
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) {
        try { await fleet(['daemon', 'status']); return; } catch { await delay(100); }
      }
      throw new Error('Container fleetd did not become ready');
    }
    try {
      await docker(['volume', 'create', volume]);
      await docker(['run', '--detach', '--name', name, '--init', '--network', 'none', '--read-only',
        '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--memory', '2g', '--pids-limit', '512',
        '--cgroup-parent', cgroupParent, '--tmpfs', '/tmp:rw,nosuid,nodev,size=256m,mode=1777',
        '--volume', volume + ':/home/node', process.env.CTLFLOW_FLEET_IMAGE]);
      await ready();
      const credential = () => node('import{readFileSync,statSync}from"node:fs";import{createHash}from"node:crypto";const path="/home/node/.config/ctlflow/fleetd.json";console.log(JSON.stringify({digest:createHash("sha256").update(readFileSync(path)).digest("hex"),uid:statSync(path).uid,mode:statSync(path).mode&511}));');
      const before = JSON.parse(await credential());
      await scope.test('process and OS-user credential belong to the unprivileged volume owner', async () => {
        assert.equal((await node('console.log(process.getuid())')).trim(), '1000');
        assert.equal(before.uid, 1000); assert.equal(before.mode, 0o600);
        assert.equal(JSON.parse(await fleet(['daemon', 'status'])).controller.name, 'local-docker');
      });
      await node('import{mkdirSync,writeFileSync}from"node:fs";process.umask(63);const path="/home/node/workspaces/example";mkdirSync(path+"/agents/assistant",{recursive:true});writeFileSync(path+"/runtime.toml",\'fleet = "example"\\n[coordination]\\nadapter = "crossfire"\\nserver = "http://127.0.0.1:8080"\\nowner = "@admin:local.test"\\n[[instances]]\\nkey = "alpha"\\nname = "example-alpha"\\ndefinition = "assistant"\\nworkarea = "agents/assistant/workarea/alpha"\\n\');writeFileSync(path+"/agents/assistant/agent.toml",\'name = "Local fixture"\\nruntime = "codex"\\n[runtime_options]\\n\');writeFileSync(path+"/agents/assistant/AGENTS.md","Local fixture. No external requests are authorized.");');
      await fleet(['add', '/home/node/workspaces/example']);
      const registered = JSON.parse(await fleet(['show', 'example']));
      assert.equal(registered.instances.length, 1);
      assert.equal(registered.instances[0].desiredActive, false);
      assert.equal(registered.instances[0].phase, 'stopped');
      await docker(['restart', '--time', '60', name]);
      await ready();
      await scope.test('restart retains authentication, identity and explicitly inactive registration without enrollment', async () => {
        const resumed = JSON.parse(await fleet(['show', 'example']));
        assert.equal(resumed.fleetId, registered.fleetId);
        assert.equal(resumed.instances[0].desiredActive, false);
        assert.equal(resumed.instances[0].phase, 'stopped');
        assert.deepEqual(JSON.parse(await credential()), before);
      });
    } finally {
      try { await docker(['rm', '--force', name]); }
      finally { await docker(['volume', 'rm', volume]); }
    }
  });
});
