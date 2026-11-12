import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { promisify } from 'node:util';
import { acquireFileLock } from '@ctlflow/crossfire-adapter-filesystem/lock';
import { observe, record, text, integer, type ContractTarget } from '@ctlflow/crossfire-test-support/contract-process';
import { piExtensionSource } from '@ctlflow/crossfire-test-support/pi';
import { nativeModels } from '@ctlflow/crossfire-test-support/native-models';
import { vmFixture, type VmBootFixture, type VmImageFixture } from './vm-fixture.js';

const execute = promisify(execFile);
const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
const command = (values: readonly string[]) => values.map(quote).join(' ');
const piHistory = (state: string) => join(state, '.pi/histories', createHash('sha256').update('control').digest('hex') + '.jsonl');
function ssh(boot: VmBootFixture): string[] {
  return ['-F', '/dev/null', '-T', '-S', join(boot.control, 'mux'), '-o', 'ControlMaster=no', '-o', 'BatchMode=yes',
    '-o', 'IdentityAgent=none', '-o', 'ProxyCommand=/usr/bin/false', 'root@ctlflow-' + boot.id];
}
async function python(boot: VmBootFixture, source: string): Promise<Record<string, unknown>> {
  const result = await execute('/usr/bin/ssh', [...ssh(boot), command(['/usr/bin/python3', '-c', source])], { timeout: 15000, maxBuffer: 65536 });
  return record(JSON.parse(result.stdout) as unknown);
}

// Real native harnesses, no provider requests. Assertions stay in this shared
// bank; each selected native executable owns actual VM startup and teardown.
export type VmNativeFixtures = Readonly<{ codex: string; node: string; pi: string }>;
function protocol(boot: VmBootFixture, state: string, runtime: 'codex' | 'pi', binaries: VmNativeFixtures) {
  const values = runtime === 'codex'
    ? ['/usr/bin/env', '-i', 'HOME=/root', 'LANG=C.UTF-8', 'PATH=/usr/local/bin:/usr/bin:/bin', 'CODEX_HOME=' + join(state, '.codex'), binaries.codex, 'app-server', '--listen', 'stdio://']
    : ['/usr/bin/env', '-i', 'HOME=/root', 'LANG=C.UTF-8', 'PATH=/usr/local/bin:/usr/bin:/bin', 'PI_CODING_AGENT_DIR=' + join(state, '.pi'), binaries.node, binaries.pi,
      '--mode', 'rpc', '--offline', '--no-extensions', '--no-skills', '--no-prompt-templates', '--no-themes', '--no-approve', '--no-tools', '--session', piHistory(state),
      '--extension', join(state, '.pi/crossfire-extension.mjs'), '--append-system-prompt', join(state, '.pi/crossfire-instructions.txt')];
  const child = spawn('/usr/bin/ssh', [...ssh(boot), 'cd -- ' + quote(state) + ' && exec ' + command(values)], { stdio: ['pipe', 'pipe', 'pipe'] });
  let pending = '', diagnostics = '', ended = false, sequence = 0, malformed: Error | undefined;
  const frames: Record<string, unknown>[] = [];
  child.stdout.on('data', (chunk: Buffer) => {
    pending += chunk.toString('utf8');
    if (Buffer.byteLength(pending) > 4 * 1024 * 1024) { pending = ''; malformed = new Error('Native VM test frame exceeds its bound'); return; }
    while (pending.includes('\n')) {
      const index = pending.indexOf('\n'), line = pending.slice(0, index); pending = pending.slice(index + 1);
      if (!line) continue;
      try { frames.push(record(JSON.parse(line) as unknown)); } catch (error) { malformed = error instanceof Error ? error : new Error(String(error)); }
    }
  });
  child.stderr.on('data', (chunk: Buffer) => { diagnostics = (diagnostics + chunk.toString('utf8')).slice(-16384); });
  child.on('error', error => { malformed = error; }); child.on('close', () => { ended = true; });
  const notify = (method: string, params: Record<string, unknown> = {}) => child.stdin.write(JSON.stringify({ method, params }) + '\n');
  async function request(method: string, params: Record<string, unknown> = {}) {
    const id = String(++sequence);
    child.stdin.write(JSON.stringify(runtime === 'codex' ? { id, method, params } : { id, type: method, ...params }) + '\n');
    let response: Record<string, unknown> | undefined;
    await observe(() => {
      if (malformed) throw malformed;
      assert(!ended, 'Native guest process ended: ' + diagnostics);
      assert(!frames.some(frame => frame.method === 'turn/started' || frame.type === 'agent_start'), 'Metadata inspection must create zero model turns');
      assert(!frames.some(frame => frame.type === 'extension_error'), 'The actual owned Pi extension must load without errors');
      response = frames.find(frame => frame.id === id);
      return response !== undefined;
    }, 'Actual guest ' + runtime + ' response for ' + method, 20000);
    assert(response); assert.equal(response.error, undefined, String(response.error).slice(0, 2048));
    if (runtime === 'pi') { assert.equal(response.success, true); return response.data === undefined ? {} : record(response.data); }
    return record(response.result);
  }
  async function control(operation: string, parameters: Record<string, unknown>) {
    assert.equal(runtime, 'pi');
    const id = randomUUID(), payload = Buffer.from(JSON.stringify({ ...parameters, id, operation })).toString('base64url');
    await request('prompt', { message: '/crossfire-control ' + payload });
    let reply: Record<string, unknown> | undefined;
    await observe(() => {
      assert(!ended, 'Pi control process ended: ' + diagnostics);
      assert(!frames.some(frame => frame.type === 'agent_start'), 'Owned Pi metadata control must create zero model turns');
      for (const frame of frames) if (frame.type === 'extension_ui_request' && frame.method === 'notify' && typeof frame.message === 'string'
        && frame.message.startsWith('{"crossfire":true,')) {
        const candidate = record(JSON.parse(frame.message) as unknown);
        if (candidate.id === id) reply = record(candidate.data);
      }
      return reply !== undefined;
    }, 'Actual Pi owned extension confirms ' + operation, 10000);
    assert(reply); return reply;
  }
  async function close() {
    child.stdin.end();
    try { await observe(() => ended, 'Native guest metadata process closes after EOF', 10000); }
    finally { if (!ended) { child.kill('SIGKILL'); await observe(() => ended, 'Exact test SSH process closure', 5000); } }
    assert(!frames.some(frame => frame.method === 'turn/started' || frame.type === 'agent_start'));
  }
  return { request, notify, control, close };
}

export async function vmExecutionContracts(scope: TestContext, selected: Pick<ContractTarget, 'name' | 'daemon'>, image: VmImageFixture, binaries: VmNativeFixtures): Promise<void> {
  const fixture = await vmFixture(selected, image), secret = randomUUID();
  let codexId = '', piId = '', rollout = '';
  const server = createServer((request, response) => {
    response.writeHead(request.headers.authorization === 'Bearer ' + secret ? 200 : 403, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ binding: 'only-this-fixture' }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address !== 'string');
  for (const name of ['.codex', '.pi']) mkdirSync(join(fixture.state, name), { mode: 0o700 });
  writeFileSync(join(fixture.state, '.codex/auth.json'), '{}', { mode: 0o600 });
  const catalog = join(fixture.state, '.codex/models.json');
  writeFileSync(catalog, JSON.stringify(nativeModels()), { mode: 0o600 });
  // This metadata-only fixture has no remote apps. Native connector discovery
  // would retry external MCP startup on the deliberately disconnected guest.
  writeFileSync(join(fixture.state, '.codex/config.toml'), 'model="fixture-model"\nmodel_catalog_json=' + JSON.stringify(catalog)
    + '\nmodel_provider="fixture"\n[features]\napps=false\n[model_providers.fixture]\nname="Offline VM fixture"\nbase_url="http://127.0.0.1:9/v1"\nwire_api="responses"\nrequires_openai_auth=false\nrequest_max_retries=0\nstream_max_retries=0\n', { mode: 0o600 });
  writeFileSync(join(fixture.state, '.pi/auth.json'), '{}', { mode: 0o600 });
  // The production Pi owner allocates an empty private file. Pi itself writes
  // its native header; a missing file intentionally remains unsaved until chat.
  mkdirSync(join(fixture.state, '.pi/histories'), { mode: 0o700 });
  writeFileSync(piHistory(fixture.state), '', { mode: 0o600 });
  const instructions = 'Offline native retention fixture. No work requested.', digest = createHash('sha256').update(instructions).digest('hex');
  writeFileSync(join(fixture.state, '.pi/crossfire-extension.mjs'), piExtensionSource(), { mode: 0o600 });
  writeFileSync(join(fixture.state, '.pi/crossfire-instructions.txt'), instructions, { mode: 0o600 });
  const marker = randomUUID();
  try {
    for (const phase of [1, 2]) await scope.test('real guest boot/native retention ' + phase + ': ' + selected.name, async childScope => {
      const started = performance.now(), boot = fixture.boot(address.port);
      try {
        await boot.expect('ready');
        assert.throws(() => acquireFileLock(join(fixture.ownership, 'owner')), { code: 'ELOCKED' });
        const script = [
          'import errno,json,os,pathlib,subprocess,urllib.request,urllib.error',
          'state=pathlib.Path(' + JSON.stringify(fixture.state) + ');originals=pathlib.Path(' + JSON.stringify(fixture.originals) + ')',
          'checks={"retained":(state/"retained.txt").read_text()=="host-backed agent data","outsideHidden":not pathlib.Path(' + JSON.stringify(join(fixture.root, 'home')) + ').exists()}',
          'subprocess.run(["/usr/bin/mount","-o","remount,rw",str(originals)],capture_output=True)',
          'try:(originals/"must-not-write").write_text("forbidden")',
          'except OSError as error:checks["readonly"]=error.errno==errno.EROFS',
          'else:checks["readonly"]=False',
          'url="http://127.0.0.1:' + address.port + '/binding"',
          'with urllib.request.urlopen(urllib.request.Request(url,headers={"Authorization":"Bearer ' + secret + '"}),timeout=5) as response:checks["ownListener"]=response.status==200',
          'try:urllib.request.urlopen(urllib.request.Request(url,headers={"Authorization":"Bearer wrong-binding"}),timeout=5)',
          'except urllib.error.HTTPError as error:checks["wrongBinding"]=error.code==403',
          'else:checks["wrongBinding"]=False',
          'checks["networkDisabled"]=list(pathlib.Path("/sys/class/net").iterdir())==[pathlib.Path("/sys/class/net/lo")]',
          'checks["networkSshMasked"]=subprocess.run(["/usr/bin/systemctl","is-enabled","ssh.service","ssh.socket"],capture_output=True,text=True).stdout.splitlines()==["masked","masked"]',
          'print(json.dumps(checks))',
        ].join('\n');
        const checked = await python(boot, script); assert(Object.values(checked).every(value => value === true), JSON.stringify(checked));
        const providerKey = "isolated-test-'\"$(not-executed)\nsecond-line", expected = createHash('sha256').update(providerKey).digest('hex');
        const delivery = await execute('/usr/bin/ssh', ['-F', '/dev/null', '-T', '-S', join(boot.control, 'mux'), '-o', 'ControlMaster=no',
          '-o', 'ProxyCommand=/usr/bin/false', '-o', 'SendEnv=CROSSFIRE_PROVIDER_SECRET', 'root@ctlflow-' + boot.id,
          command(['/usr/bin/python3', '-c', 'import hashlib,os;print(hashlib.sha256(os.environ.get("CROSSFIRE_PROVIDER_SECRET", "").encode()).hexdigest())'])],
          { env: { ...process.env, CROSSFIRE_PROVIDER_SECRET: providerKey }, timeout: 10000, maxBuffer: 4096 });
        assert.equal(delivery.stdout.trim(), expected, 'Exact selected provider key crosses the authenticated multiplex channel without a secret argument');
        const codex = protocol(boot, fixture.state, 'codex', binaries);
        try {
          await codex.request('initialize', { clientInfo: { name: 'ctlflow-vm-contract', version: '0.1.26' }, capabilities: { experimentalApi: true } });
          codex.notify('initialized');
          if (phase === 1) {
            const created = await codex.request('thread/start', { cwd: fixture.state, historyMode: 'paginated', ephemeral: false, config: { approval_policy: 'never', sandbox_mode: 'read-only' } });
            codexId = text(record(created.thread).id);
            await codex.request('thread/name/set', { threadId: codexId, name: 'VM retention fixture' });
            await codex.request('thread/inject_items', { threadId: codexId, items: [{ type: 'message', id: marker, role: 'developer', content: [{ type: 'input_text', text: 'Offline native retention fixture. No work requested.' }] }] });
          } else {
            const resumed = await codex.request('thread/resume', { threadId: codexId, cwd: fixture.state, excludeTurns: true });
            assert.equal(record(resumed.thread).id, codexId);
          }
          const loaded = record((await codex.request('thread/read', { threadId: codexId, includeTurns: false })).thread);
          assert.equal(loaded.name, 'VM retention fixture'); assert.equal(loaded.cwd, fixture.state);
          rollout = text(loaded.path); assert(rollout.startsWith(join(fixture.state, '.codex/sessions/')));
          assert(readFileSync(rollout, 'utf8').split('\n').filter(Boolean).some(line => record(JSON.parse(line) as unknown).type === 'response_item' && record(record(JSON.parse(line) as unknown).payload).id === marker));
          assert.equal(statSync(rollout).uid, process.getuid?.());
        } finally { await codex.close(); }
        const pi = protocol(boot, fixture.state, 'pi', binaries);
        try {
          const commands = (await pi.request('get_commands')).commands;
          assert(Array.isArray(commands) && commands.some(value => record(value).name === 'crossfire-control'), 'Owned native Pi control is loaded before invoking it');
          if (phase === 1) {
            await pi.request('set_session_name', { name: 'VM Pi retention fixture' });
            const applied = await pi.control('instructions', { text: instructions, digest });
            assert.equal(typeof applied.entryId, 'string');
          }
          const state = await pi.request('get_state');
          if (phase === 1) piId = text(state.sessionId); else assert.equal(state.sessionId, piId);
          assert.equal(state.sessionName, 'VM Pi retention fixture');
          const history = piHistory(fixture.state); assert.equal(state.sessionFile, history);
          const saved = readFileSync(history, 'utf8').split('\n').filter(Boolean).map(line => record(JSON.parse(line) as unknown));
          assert.equal(saved[0]?.type, 'session'); assert.equal(saved[0]?.id, piId); assert.equal(saved[0]?.cwd, fixture.state);
          assert(saved.some(entry => entry.type === 'custom' && entry.customType === 'crossfire-instructions'
            && record(entry.data).text === instructions && record(entry.data).digest === digest));
          assert.equal(statSync(history).uid, process.getuid?.());
          const stats = await pi.request('get_session_stats'); assert.equal(integer(stats.userMessages), 0); assert.equal(integer(stats.assistantMessages), 0);
        } finally { await pi.close(); }
        const receipt = record(JSON.parse(readFileSync(join(fixture.ownership, 'vm-receipt.json'), 'utf8')) as unknown);
        assert.equal(receipt.state, 'ready'); assert(integer(receipt.readyAt) >= integer(receipt.startedAt));
        childScope.diagnostic(JSON.stringify({ target: selected.name, phase, elapsedMs: Math.round(performance.now() - started), codexId, piId, modelTurns: 0, checks: checked }));
      } finally { await boot.finish('close'); }
      const release = acquireFileLock(join(fixture.ownership, 'owner')); release();
    });
    for (const action of ['kill', 'controller-kill'] as const) await scope.test(action + ' destroys guest and releases host ownership: ' + selected.name, async () => {
      const boot = fixture.boot();
      try {
        await boot.expect('ready'); await boot.finish(action);
        const release = acquireFileLock(join(fixture.ownership, 'owner')); release();
        assert(existsSync(rollout)); assert(readFileSync(rollout, 'utf8').includes(marker));
      } finally { if (!boot.ended()) await boot.finish('close'); }
    });
    await scope.test('outbound guest interface and controlled host endpoint: ' + selected.name, async () => {
      const outgoing = await vmFixture(selected, image, 'outbound');
      try {
        const boot = outgoing.boot();
        try {
          await boot.expect('ready');
          const checked = await python(boot, [
          'import json,pathlib,subprocess,urllib.request',
          'interfaces=list(pathlib.Path("/sys/class/net").iterdir())',
          'routes=json.loads(subprocess.check_output(["/usr/sbin/ip","-j","route","show","default"]))',
          'gateway=routes[0]["gateway"]',
          'request=urllib.request.Request("http://"+gateway+":' + address.port + '/binding",headers={"Authorization":"Bearer ' + secret + '"})',
          'with urllib.request.urlopen(request,timeout=5) as response:reached=response.status==200',
          'masked=subprocess.run(["/usr/bin/systemctl","is-enabled","ssh.service","ssh.socket"],capture_output=True,text=True).stdout.splitlines()==["masked","masked"]',
          'print(json.dumps({"oneNetworkInterface":len(interfaces)==2,"hasDefaultRoute":len(routes)==1,"controlledHostEndpoint":reached,"networkSshMasked":masked}))',
          ].join('\n'));
          assert(Object.values(checked).every(value => value === true), JSON.stringify(checked));
        } finally { await boot.finish('close'); }
      } finally { await outgoing.close(); }
    });
  } finally {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await fixture.close();
  }
}
