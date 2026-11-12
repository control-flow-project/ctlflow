import assert from 'node:assert/strict';
import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { loadConfiguration } from '@ctlflow/fleetd-storage/configuration';
import { observe, record, text, type ContractTarget } from '@ctlflow/crossfire-test-support/contract-process';

const execute = promisify(execFile);
export type VmImageFixture = Readonly<{ path: string; sha256: string; mounts: readonly string[] }>;
export type VmBootFixture = {
  id: string; control: string; scratch: string; unit: string;
  process: ChildProcessWithoutNullStreams; messages: Record<string, unknown>[];
  errors: () => string; ended: () => boolean;
  expect: (phase: 'ready' | 'failed') => Promise<void>;
  finish: (action: 'close' | 'kill' | 'controller-kill') => Promise<void>;
};

// This fixture invokes the installed supervisor and real finite user services.
// It neither starts an enrolled fleet nor contains an alternative VM backend.
export async function vmFixture(selected: Pick<ContractTarget, 'name' | 'daemon'>, image?: VmImageFixture, network: 'disabled' | 'outbound' = 'disabled') {
  assert(process.env.XDG_RUNTIME_DIR, 'VM fixture needs the actual private user runtime directory');
  const runtime = process.env.XDG_RUNTIME_DIR;
  const root = mkdtempSync(join(tmpdir(), 'cfvm-contract-'));
  const fleet = join(root, 'fleet'), home = join(root, 'home'), config = join(home, '.config'), cache = join(home, '.cache');
  const role = join(fleet, 'agents/research'), state = join(role, 'workarea/analyst'), originals = join(root, 'originals');
  for (const path of [root, fleet, home, config, role, state, originals]) mkdirSync(path, { recursive: true, mode: 0o700 });
  writeFileSync(join(originals, 'source.txt'), 'retained source original', { mode: 0o600 });
  writeFileSync(join(state, 'retained.txt'), 'host-backed agent data', { mode: 0o600 });
  writeFileSync(join(role, 'agent.toml'), 'name="Research"\nruntime="codex"\n[runtime_options]\n', { mode: 0o600 });
  writeFileSync(join(role, 'AGENTS.md'), 'Only the isolated VM acceptance fixture.\n', { mode: 0o600 });
  writeFileSync(join(fleet, 'runtime.toml'), 'fleet="research"\n[coordination]\nadapter="crossfire"\nserver="https://crossfire.example"\nowner="@owner:matrix.example"\n[[instances]]\nkey="analyst"\nname="analyst"\ndefinition="research"\nworkarea="agents/research/workarea/analyst"\n[instances.execution]\nkind="vm"\nimage="fixture"\nprofile="fixture"\n', { mode: 0o600 });
  const mounts = [{ path: originals, read_only: true }, ...(image?.mounts ?? []).map(path => ({ path, read_only: true }))];
  const mountText = '[' + mounts.map(mount => '{path=' + JSON.stringify(mount.path) + ',read_only=true}').join(',') + ']';
  writeFileSync(join(fleet, 'execution.toml'), 'memory_budget_mib=1536\nhost_reserve_mib=256\n[images.fixture]\npath=' + JSON.stringify(image?.path ?? join(root, 'missing.qcow2')) + '\nsha256="' + (image?.sha256 ?? 'a'.repeat(64)) + '"\n[profiles.fixture]\ncpus=1\nmemory_mib=768\nmaximum_memory_mib=768\nnetwork=' + JSON.stringify(network) + '\nmounts=' + mountText + '\n', { mode: 0o600 });
  const loaded = loadConfiguration(fleet); assert(loaded.ok, loaded.ok ? '' : loaded.error.message);
  const digest = loaded.value.digest;
  const ownership = join(config, 'ctlflow/native-ownership', createHash('sha256').update(state).digest('hex'));
  const environment: NodeJS.ProcessEnv = { ...process.env, HOME: home, XDG_CONFIG_HOME: config, XDG_CACHE_HOME: cache };
  delete environment.DBUS_SESSION_BUS_ADDRESS;
  const tools = (args: string[]) => execute('/usr/bin/systemctl', ['--user', ...args], { env: environment, timeout: 30000, maxBuffer: 65536 });
  const slice = 'ctlflow-vm-' + createHash('sha256').update(fleet).digest('hex') + '.slice';
  await tools(['set-property', '--runtime', slice, 'MemoryMax=1610612736', 'MemorySwapMax=0', 'TasksMax=1024']);
  const boots: VmBootFixture[] = [];
  function boot(listenerPort?: number): VmBootFixture {
    const id = randomUUID(), unit = 'ctlflow-execution-' + id + '.service';
    const control = join(runtime, 'cfvm-' + id), scratch = join(cache, 'ctlflow/vm', id);
    for (const path of [control, scratch]) mkdirSync(path, { recursive: true, mode: 0o700 });
    const request = join(scratch, 'request.json');
    writeFileSync(request, JSON.stringify({ id, directory: control, fleet, instance: 'analyst', digest,
      ownership, workspace: state, state, home: join(state, '.codex'), ...(listenerPort === undefined ? {} : { listenerPort }) }), { mode: 0o600 });
    const args = ['--user', '--quiet', '--pipe', '--wait', '--collect', '--service-type=exec', '--expand-environment=no', '--unit=' + unit,
      '--slice=' + slice, '--property=MemoryMax=1342177280', '--property=MemorySwapMax=0', '--property=TasksMax=1024', '--property=KillMode=control-group',
      '--property=TimeoutStopSec=15s', '--working-directory=' + control, '--setenv=HOME=' + home, '--setenv=XDG_CONFIG_HOME=' + config, '--setenv=XDG_CACHE_HOME=' + cache];
    if (process.env.DOTNET_ROOT) args.push('--setenv=DOTNET_ROOT=' + process.env.DOTNET_ROOT);
    args.push('--', selected.daemon.binary, ...selected.daemon.arguments, '--fleetd-vm-supervisor', request);
    const process_ = spawn('/usr/bin/systemd-run', args, { env: environment, stdio: ['pipe', 'pipe', 'pipe'] });
    const messages: Record<string, unknown>[] = [];
    let pending = '', errors = '', parseFailure: Error | undefined, ended = false;
    process_.stdout.on('data', (chunk: Buffer) => {
      pending += chunk.toString('utf8');
      if (Buffer.byteLength(pending) > 65536) { pending = ''; parseFailure = new Error('Supervisor status exceeded its bound'); return; }
      while (pending.includes('\n')) {
        const position = pending.indexOf('\n'), line = pending.slice(0, position); pending = pending.slice(position + 1);
        try { messages.push(record(JSON.parse(line) as unknown)); } catch (error) { parseFailure = error instanceof Error ? error : new Error(String(error)); }
      }
    });
    process_.stderr.on('data', (chunk: Buffer) => { errors = (errors + chunk.toString('utf8')).slice(-16384); });
    const completion = new Promise<number | null>((resolve, reject) => {
      process_.once('error', reject); process_.once('close', code => { ended = true; resolve(code); });
    });
    const result: VmBootFixture = { id, unit, control, scratch, process: process_, messages, errors: () => errors, ended: () => ended,
      async expect(phase) {
        await observe(() => {
          assert(!ended, 'Supervisor exited before expected state: ' + errors);
          if (parseFailure) throw parseFailure;
          if (phase === 'ready') assert(!messages.some(message => message.state === 'failed'), 'Guest startup failed: ' + JSON.stringify(messages));
          return messages.some(message => message.state === phase);
        }, 'Supervisor must report ' + phase, phase === 'ready' ? 240000 : 15000);
        assert(messages.every(message => message.id === id));
        assert.deepEqual(messages.map(message => message.state), ['admitted', phase]);
      },
      async finish(action) {
        if (!ended) {
          if (action === 'close') process_.stdin.end('close\n');
          else if (action === 'kill') await tools(['kill', '--kill-whom=main', '--signal=SIGKILL', unit]);
          else assert(process_.kill('SIGKILL'), 'Kill only the exact test controller process');
          await observe(() => ended, 'Exact VM service must finish teardown', 30000);
        }
        const code = await completion;
        if (action === 'close' && messages.some(message => message.state === 'ready')) assert.equal(code, 0, errors);
        const execution = record(JSON.parse(readFileSync(join(ownership, 'execution.json'), 'utf8')) as unknown);
        const group = join('/sys/fs/cgroup', text(execution.group));
        await observe(() => !existsSync(group) || /^populated 0$/mu.test(readFileSync(join(group, 'cgroup.events'), 'utf8')),
          'Supervisor and all guest/helper processes must close before a successor', 30000);
        if (action !== 'kill') { assert(!existsSync(scratch), 'Supervisor removes disk scratch'); assert(!existsSync(control), 'Supervisor removes socket scratch'); }
      } };
    boots.push(result); return result;
  }
  async function close() {
    for (const active of boots) {
      if (!active.ended()) { await tools(['stop', active.unit]); await observe(active.ended, 'Fixture service cleanup', 30000); }
      active.process.stdin.destroy(); rmSync(active.control, { recursive: true, force: true }); rmSync(active.scratch, { recursive: true, force: true });
    }
    await tools(['stop', slice]); await tools(['revert', slice]); rmSync(root, { recursive: true, force: true });
  }
  return { root, state, originals, ownership, fleet, boot, close };
}
