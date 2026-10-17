import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import { value } from '@ctlflow/crossfire-test-support/result';
import { piProvider } from '@ctlflow/crossfire-test-support/pi-provider';
import { piBinary } from '@ctlflow/crossfire-test-support/pi';
import { piRuntime } from '@ctlflow/crossfire-adapter-pi/owned';
import type { OwnedRuntimeConnection, OwnedRuntimeInput } from '@ctlflow/crossfire-agent-core/owned-runtime';
import type { RuntimeDecision, RuntimeObservationEvent } from '@ctlflow/crossfire-agent-core/runtime';
import { success } from '@ctlflow/crossfire-kernel/result';
import { createHash } from 'node:crypto';
import { piState, piHistory } from '@ctlflow/crossfire-adapter-pi/state';
import { startPi } from '@ctlflow/crossfire-adapter-pi/protocol';
import { admitPi } from '@ctlflow/crossfire-adapter-pi/admission';
import { piDelivery } from '@ctlflow/crossfire-adapter-pi/connection';
import type { UsageSample } from '@ctlflow/crossfire-contracts/statistics';
import { until } from '../scripts/test-support/listener.js';

test('native Pi malformed UTF-8 fails the connection without delivering replacement text', async scope => {
  mkdirSync(join(process.cwd(), '.temp'), { recursive: true, mode: 0o700 });
  const directory = mkdtempSync(join(process.cwd(), '.temp/pi-invalid-utf8-'));
  cleanup(scope, () => rmSync(directory, { recursive: true, force: true }));
  const binary = join(directory, 'pi'), frames: Record<string, unknown>[] = [];
  writeFileSync(binary, '#!' + process.execPath + '\n' + `
if (process.argv.includes('--version')) console.log('1.0.0');
else { process.stdin.resume(); process.stdout.write(Buffer.concat([Buffer.from('{"type":"message","body":"'), Buffer.from([0xc0, 0xaf]), Buffer.from('"}\\n')])); }
`, { mode: 0o700 });
  const native = await startPi({ binary, workspace: directory, stateDirectory: directory, home: join(directory, 'home'), profile: 'invalid-utf8',
    sessionFile: join(directory, 'session.jsonl'), instructions: 'A protocol-boundary fixture.', event: event => frames.push(event) }, new AbortController().signal);
  cleanup(scope, () => native.close());
  await assert.rejects(native.request('get_state'), TypeError);
  assert.equal(frames.length, 0, 'Invalid native bytes cannot become a different valid event');
});

async function fixture(scope: TestContext) {
  const directory = mkdtempSync(join(process.cwd(), '.temp/owned-pi-'));
  cleanup(scope, () => rmSync(directory, { recursive: true, force: true }));
  const workspace = join(directory, 'workspace'), stateDirectory = join(directory, 'state');
  mkdirSync(workspace, { mode: 0o700 }); mkdirSync(stateDirectory, { mode: 0o700 });
  const provider = await piProvider(scope), events: RuntimeObservationEvent[] = [], usage: UsageSample[] = [];
  const input: OwnedRuntimeInput = { profile: 'pi-proof', name: 'pi-proof', workspace, stateDirectory, allowNewHistory: true,
    instructions: 'Private Pi role instructions. Historical marker silver orchard 913.',
    options: { provider: 'fixture', model: 'fixture-model', thinking_level: 'high' },
    hooks: { requestDecision: async () => { throw new Error('Unexpected native owner question'); }, observe: event => events.push(event), usage: sample => usage.push(sample) } };
  const adapter = piRuntime(piBinary());
  let runtime: OwnedRuntimeConnection | undefined;
  cleanup(scope, () => runtime?.close());
  async function start() { runtime = value(await adapter.start(input, new AbortController().signal)); input.allowNewHistory = false; return runtime; }
  async function idle(connection: OwnedRuntimeConnection = runtime!) { await until(async () => await connection.turnControl.activeTurn() === null, 'Pi did not settle'); }
  function entries() {
    const home = join(stateDirectory, '.pi/histories');
    return readdirSync(home).map(name => readFileSync(join(home, name), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>));
  }
  return { directory, provider, adapter, input, events, usage, start, idle, entries };
}

test('Pi resume never manufactures an initial history in either mode', { timeout: 60000 }, async scope => {
  const proof = await fixture(scope);
  for (const historyMode of ['shared', 'per-room'] as const) {
    const result = await proof.adapter.start({ ...proof.input, allowNewHistory: false, listenerOptions: { historyMode } }, new AbortController().signal);
    if (result.ok) await result.value.close();
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'missing');
    assert.deepEqual(value(await proof.adapter.savedContexts(proof.input)), []);
  }
  assert.equal(proof.provider.requests.length, 0);
});

test('stock Pi retains zero-turn native identity and effective instructions across restart', { timeout: 60000 }, async scope => {
  const proof = await fixture(scope);
  let runtime = await proof.start();
  const sessionId = runtime.sessionId;
  assert.equal(runtime.attachment, null); assert.deepEqual(await runtime.attachments(), []);
  assert.equal(runtime.approval, 'none'); assert.equal(proof.provider.requests.length, 0);
  const initial = proof.entries()[0]!;
  assert.equal(initial[0]?.id, sessionId);
  assert.equal(initial.filter(entry => entry.type === 'message').length, 0, 'Startup must not manufacture a user turn');
  assert.equal(initial.filter(entry => entry.customType === 'crossfire-instructions').length, 1);
  await runtime.close(); runtime = await proof.start();
  assert.equal(runtime.sessionId, sessionId); assert.equal(proof.provider.requests.length, 0);
  const reopened = proof.entries()[0]!;
  assert.equal(JSON.stringify(reopened.slice(0, initial.length)), JSON.stringify(initial), 'Native history prefix remains unchanged');
  assert.equal(reopened.filter(entry => entry.customType === 'crossfire-instructions').length, 1);
  assert.equal(reopened.filter(entry => entry.type === 'message').length, 0);
  assert.deepEqual(value(await proof.adapter.savedContexts(proof.input)), [{ context: 'shared', runtime: 'pi', sessionId, workspace: proof.input.workspace }]);
  proof.provider.tool('bash', { command: 'printf native-pi-tools', timeout: 5 });
  await runtime.deliver('Run the requested inert tool; keep historical fact azure 452.', 'pi-tool-proof');
  runtime.acknowledge(['pi-tool-proof']); await proof.idle(runtime);
  assert.equal(proof.provider.requests.length, 2);
  assert.deepEqual(proof.usage.at(-1)?.tokens, { input: 10, cachedInput: 4, cacheWriteInput: 0, output: 6, reasoningOutput: null, total: 16 });
  assert(JSON.stringify(proof.provider.requests[0]).includes(proof.input.instructions));
  assert(proof.events.some(event => event.kind === 'output' && event.text.includes('native-pi-tools')));
  await runtime.close(); proof.input.instructions = 'Updated Pi role instructions.'; runtime = await proof.start();
  assert.equal(runtime.sessionId, sessionId);
  await runtime.deliver('Use the retained historical fact.', 'pi-resume-proof'); runtime.acknowledge(['pi-resume-proof']); await proof.idle(runtime);
  assert(JSON.stringify(proof.provider.requests[2]).includes('azure 452'));
  assert(JSON.stringify(proof.provider.requests[2]).includes('Updated Pi role instructions.'));
  assert.equal(proof.entries()[0]!.filter(entry => entry.customType === 'crossfire-instructions').length, 2);
});

test('Pi rejects native model or thinking substitution before any model request', { timeout: 60000 }, async scope => {
  const proof = await fixture(scope);
  for (const options of [{ provider: 'fixture', model: 'missing-model' }, { provider: 'fixture', model: 'plain-model', thinking_level: 'high' },
    { provider: 'fixture', model: 'fixture-model', thinking_level: 'max' }, { model_reasoning_effort: 'high' }, { sandbox_mode: 'danger-full-access' }]) {
    const result = await proof.adapter.inspect({ ...proof.input, options }, new AbortController().signal);
    assert.equal(result.ok, false, JSON.stringify(options));
  }
  assert.equal(proof.provider.requests.length, 0);
  assert.equal(existsSync(join(proof.input.stateDirectory, '.pi')), false);
  value(await proof.adapter.inspect(proof.input, new AbortController().signal));
  assert.equal(proof.provider.requests.length, 0);
});

test('Pi hard interruption fences the original run and never interrupts its replacement', { timeout: 60000 }, async scope => {
  const proof = await fixture(scope), runtime = await proof.start();
  proof.provider.hold(); await runtime.deliver('Work until interrupted.', 'pi-original'); runtime.acknowledge(['pi-original']);
  await until(() => Boolean(proof.provider.held()));
  const turn = await runtime.turnControl.activeTurn(); assert(turn);
  assert.equal(await runtime.turnControl.interrupt(turn), 'interrupted');
  proof.provider.hold(); await runtime.deliver('Steering: answer this instead.', 'pi-steering', undefined, 'steering'); runtime.acknowledge(['pi-steering']);
  await until(() => proof.provider.requests.length === 2);
  assert.equal(await runtime.turnControl.interrupt(turn), 'inactive');
  assert(await runtime.turnControl.activeTurn());
  proof.provider.finish(); await proof.idle(runtime);
  assert(JSON.stringify(proof.provider.requests[1]).includes('Steering: answer this instead.'));
});

test('Pi recovers real receipts without duplicate delivery, and missing history never becomes fresh history', { timeout: 60000 }, async scope => {
  const proof = await fixture(scope); let runtime = await proof.start();
  await runtime.deliver('Native historical user receipt.', 'pi-retained-receipt'); await proof.idle(runtime);
  const sessionId = runtime.sessionId; await runtime.close(); runtime = await proof.start();
  assert.equal(runtime.sessionId, sessionId);
  assert.equal(await runtime.recover('Native historical user receipt.', 'pi-retained-receipt'), true);
  assert.equal(proof.provider.requests.length, 1);
  runtime.acknowledge(['pi-retained-receipt']); await runtime.close();
  const home = join(proof.input.stateDirectory, '.pi/histories'); rmSync(join(home, readdirSync(home)[0]!));
  const result = await proof.adapter.start(proof.input, new AbortController().signal);
  assert.equal(result.ok, false); if (!result.ok) assert.equal(result.error.code, 'missing');
  assert.equal(proof.provider.requests.length, 1);
});

test('Pi per-room histories stay separate and explicit reset preserves archived native histories', { timeout: 60000 }, async scope => {
  const proof = await fixture(scope); proof.input.listenerOptions = { historyMode: 'per-room' };
  const runtime = await proof.start(); assert(runtime.conversation);
  const first = await runtime.conversation('!first:fixture'), second = await runtime.conversation('!second:fixture');
  assert.notEqual(first.sessionId, second.sessionId); assert.notEqual(first.sessionId, runtime.sessionId);
  await first.deliver('Private first-room fact violet 51.', 'pi-first-room'); first.acknowledge(['pi-first-room']);
  await until(async () => !(await first.inspect()).busy);
  await second.deliver('Second room has no violet fact.', 'pi-second-room'); second.acknowledge(['pi-second-room']);
  await until(async () => !(await second.inspect()).busy);
  assert(!JSON.stringify(proof.provider.requests[1]).includes('Private first-room fact violet 51.'));
  const contexts = value(await proof.adapter.savedContexts(proof.input)); assert.equal(contexts.length, 3);
  await runtime.close();
  const resetId = '304cc611-38f3-4a64-946b-a8f59508b2a4'; value(await proof.adapter.reset({ ...proof.input, resetId }));
  value(await proof.adapter.reset({ ...proof.input, resetId }));
  assert.equal(readdirSync(join(proof.input.stateDirectory, '.pi/archive', resetId, 'histories')).length, 3);
  proof.input.allowNewHistory = true; const fresh = await proof.start();
  assert(!contexts.some(context => context.sessionId === fresh.sessionId)); assert.equal(proof.provider.requests.length, 2);
});

test('Pi keeps a newly opened room alive after the mention admission ends', { timeout: 60000 }, async scope => {
  const proof = await fixture(scope); proof.input.listenerOptions = { historyMode: 'per-room' };
  const runtime = await proof.start(), admission = new AbortController(), roomId = '!steered:fixture';
  assert(runtime.conversation);
  assert.equal(await runtime.turnControl.activeTurn(roomId, { priority: 'steering', signal: admission.signal }), null);
  const room = await runtime.conversation(roomId), sessionId = room.sessionId;
  admission.abort(new Error('The Matrix poll cycle ended'));
  assert.equal(runtime.signal.aborted, false, 'Completed admission cannot become the native lifetime');
  assert.equal(room.signal.aborted, false);
  proof.provider.hold(); await room.deliver('Work in this exact room after admission.', 'pi-room-admission'); room.acknowledge(['pi-room-admission']);
  await until(() => proof.provider.held() !== undefined);
  assert.equal((await runtime.inspect()).busy, true);
  const turn = await runtime.turnControl.activeTurn(roomId); assert(turn);
  assert.equal(await runtime.turnControl.interrupt(turn), 'interrupted');
  await room.deliver('Apply the new directed instruction.', 'pi-room-admission-replacement'); room.acknowledge(['pi-room-admission-replacement']);
  await until(async () => !(await room.inspect()).busy);
  assert.equal((await runtime.conversation(roomId)).sessionId, sessionId);
  assert.equal(proof.events.some(event => event.kind === 'state' && event.observation.state === 'failed'), false);
  assert.equal(proof.provider.requests.length, 2);
});

test('Pi owner choice uses the shared decision interface and can be interrupted while awaiting an answer', { timeout: 60000 }, async scope => {
  const proof = await fixture(scope), decisions: RuntimeDecision[] = [];
  proof.input.hooks.requestDecision = async decision => {
    decisions.push(decision);
    return success({ answers: { [decision.request]: { answers: ['B'] } } });
  };
  let runtime = await proof.start();
  proof.provider.tool('crossfire_question', { title: 'Pick an option', prompt: 'Which route?', options: ['A', 'B', 'C'] });
  await runtime.deliver('Ask the owner which route.', 'pi-question'); runtime.acknowledge(['pi-question']); await proof.idle(runtime);
  assert.equal(decisions.length, 1); assert.equal(decisions[0]?.runtime, 'pi');
  assert.deepEqual(decisions[0]?.questions?.[0]?.options.map(option => option.label), ['A', 'B', 'C']);
  const messages = proof.provider.requests[1]?.messages as { role: string; content: string }[];
  assert(messages.some(message => message.role === 'tool' && JSON.parse(message.content).answer === 'B'));
  await runtime.close();
  proof.input.hooks.requestDecision = async (decision, signal) => {
    decisions.push(decision);
    await new Promise<void>((_resolve, reject) => { signal.addEventListener('abort', () => reject(signal.reason), { once: true }); });
    throw new Error('Cancelled owner question must not produce an answer');
  };
  runtime = await proof.start(); proof.provider.tool('crossfire_question', { title: 'Await owner', prompt: 'Required answer', options: ['A', 'B'] });
  await runtime.deliver('Ask and await an owner answer.', 'pi-question-abort'); runtime.acknowledge(['pi-question-abort']);
  await until(() => decisions.length === 2);
  const turn = await runtime.turnControl.activeTurn(); assert(turn);
  try {
    assert.equal(await runtime.turnControl.interrupt(turn), 'interrupted');
    await runtime.deliver('Owner steered without answering. Continue independently.', 'pi-question-steering');
    runtime.acknowledge(['pi-question-steering']); await proof.idle(runtime);
  } catch (error) {
    scope.diagnostic(JSON.stringify({ states: proof.events.filter(event => event.kind === 'state').map(event => event.observation.state + ':' + event.observation.errorMessage),
      requests: proof.provider.requests.map(request => ({ messages: (request.messages as { role: string; content: unknown }[]).filter(message => message.role !== 'system') })) }).slice(0, 4000));
    throw error;
  }
  assert.equal(proof.events.some(event => event.kind === 'state' && event.observation.state === 'failed'), false,
    'An intentional interruption is not a native failure or recovery incident');
});

test('invalid model question text returns a native tool error without stopping Pi or asking the owner', { timeout: 60000 }, async scope => {
  const proof = await fixture(scope), runtime = await proof.start();
  const invalid = [
    { title: 'Question', prompt: '東京'.repeat(4001), options: ['A', 'B'] },
    { title: 'Question', prompt: 'Invalid\u0000 prompt' },
    { title: '😀'.repeat(750), prompt: 'Question title exceeds the shared text contract' },
    { title: 'Question', prompt: 'Invalid choice label', options: ['Valid', 'Invalid\u0000'] },
  ];
  for (const [caseIndex, parameters] of invalid.entries()) {
    const before = proof.provider.requests.length;
    proof.provider.tool('crossfire_question', parameters);
    const messageId = 'pi-invalid-question-' + caseIndex;
    await runtime.deliver('Try the controlled question tool and handle its validation error.', messageId);
    runtime.acknowledge([messageId]); await proof.idle(runtime);
    assert.equal(runtime.signal.aborted, false, 'A model argument error must not stop the native engine');
    assert.equal(proof.provider.requests.length - before, 2, 'The model receives the native tool error and continues');
    const messages = proof.provider.requests.at(-1)?.messages as { role: string; content: string }[];
    assert.equal(messages.some(message => message.role === 'tool' && /question/iu.test(message.content)), true);
  }
  assert.equal(proof.events.some(event => event.kind === 'state' && event.observation.state === 'failed'), false);
});

test('Pi recopies authentication on resume and native tools use the owned private state', { timeout: 60000 }, async scope => {
  const proof = await fixture(scope); let runtime = await proof.start();
  await runtime.close(); writeFileSync(join(proof.provider.home, 'auth.json'), JSON.stringify({ fixture: { type: 'api_key', key: 'replacement-local-fixture' } }), { mode: 0o600 });
  runtime = await proof.start();
  assert.equal(readFileSync(join(proof.input.stateDirectory, '.pi/auth.json'), 'utf8'), readFileSync(join(proof.provider.home, 'auth.json'), 'utf8'));
  const marker = join(proof.directory, 'environment.json');
  const source = 'require("node:fs").writeFileSync(' + JSON.stringify(marker) + ',JSON.stringify({cwd:process.cwd(),home:process.env.PI_CODING_AGENT_DIR,state:process.env.CROSSFIRE_PROJECT,name:process.env.CROSSFIRE_AGENT_NAME}))';
  proof.provider.tool('bash', { command: 'node -e ' + JSON.stringify(source), timeout: 5 });
  await runtime.deliver('Verify inert process environment.', 'pi-environment'); runtime.acknowledge(['pi-environment']); await proof.idle(runtime);
  assert.deepEqual(JSON.parse(readFileSync(marker, 'utf8')), { cwd: proof.input.workspace, home: join(proof.input.stateDirectory, '.pi'), state: proof.input.stateDirectory, name: proof.input.profile });
});

test('Pi free-text owner answers return only to the original native question', { timeout: 60000 }, async scope => {
  const proof = await fixture(scope), decisions: RuntimeDecision[] = [], answered: string[] = [];
  const answer = 'Use the reviewed report; preserve the original reply destination.';
  proof.input.hooks.requestDecision = async decision => {
    decisions.push(decision); assert.equal(decision.questions?.[0]?.allowText, true);
    return success({ answers: { [decision.request]: { answers: [answer] } } });
  };
  proof.input.hooks.decisionResponded = decision => { answered.push(decision.request); };
  const runtime = await proof.start();
  proof.provider.tool('crossfire_question', { title: 'Required detail', prompt: 'Which report should be used?' });
  await runtime.deliver('Ask for the required report detail.', 'pi-text-question'); runtime.acknowledge(['pi-text-question']); await proof.idle(runtime);
  assert.equal(decisions.length, 1); assert.deepEqual(answered, [decisions[0]!.request]);
  const messages = proof.provider.requests[1]?.messages as { role: string; content: string }[];
  assert(messages.some(message => message.role === 'tool' && JSON.parse(message.content).answer === answer));
});

test('Pi restart preserves an uncertain original input as a file and verifies the new native continuation before receipt', { timeout: 60000 }, async scope => {
  const proof = await fixture(scope); let runtime = await proof.start();
  const sessionId = runtime.sessionId; await runtime.close();
  const home = join(proof.input.stateDirectory, '.pi'), history = piHistory(home, piState(home).state.bindings[0]!);
  const receiptFile = join(home, 'receipts', createHash('sha256').update('shared').digest('hex') + '.json');
  const native = await startPi({ binary: piBinary(), home, workspace: proof.input.workspace, stateDirectory: proof.input.stateDirectory,
    profile: proof.input.profile, sessionFile: history, instructions: proof.input.instructions, event: () => {} }, new AbortController().signal);
  cleanup(scope, () => native.close()); await admitPi(native, proof.input.options);
  const cancelled = new AbortController(), failure = new Error('Injected loss before native publication');
  const connection = piDelivery({ ...native, control: async (operation, parameters, signal) => {
    if (operation === 'deliver') { cancelled.abort(failure); return { armed: false }; }
    return native.control(operation, parameters, signal);
  } }, { sessionId, workspace: proof.input.workspace, history, receiptFile, hooks: proof.input.hooks });
  cleanup(scope, () => connection.close());
  const text = 'Origin: room !original:fixture; sender @human:fixture; timestamp 1800000000000. Finish the original still-authorized task.';
  await assert.rejects(connection.deliver(text, 'pi-uncertain-input', cancelled.signal), /Injected loss/u);
  assert.equal(proof.provider.requests.length, 0);
  assert.equal(JSON.parse(readFileSync(receiptFile, 'utf8')).pending.text, text);
  await connection.close(); runtime = await proof.start();
  assert.equal(runtime.sessionId, sessionId);
  assert.equal(await runtime.settle(), true); runtime.acknowledge(['pi-uncertain-input']); await proof.idle(runtime);
  const files = readdirSync(join(home, 'receipts/resume-input'));
  assert.equal(files.length, 1); assert.equal(readFileSync(join(home, 'receipts/resume-input', files[0]!), 'utf8'), text);
  assert.equal(proof.provider.requests.length, 1);
  const submitted = JSON.stringify(proof.provider.requests[0]);
  assert(submitted.includes('[Crossfire session restarted]') && submitted.includes('may or may not have been received') && submitted.includes(files[0]!));
  assert(!submitted.includes(text), 'The exact attributed original is retained in a file, not fabricated as a previously received message');
  assert.equal(proof.entries()[0]!.filter(entry => entry.customType === 'crossfire-input').length, 1);
  await runtime.close(); runtime = await proof.start();
  assert.equal(await runtime.settle(), false); assert.equal(proof.provider.requests.length, 1, 'Confirmed recovery is not replayed again');
});

test('Pi delivers slash commands as literal input rather than private controls or a prompt template', { timeout: 60000 }, async scope => {
  const proof = await fixture(scope), runtime = await proof.start(), text = '/crossfire-control invalid-private-command';
  await runtime.deliver(text, 'pi-literal-slash'); runtime.acknowledge(['pi-literal-slash']); await proof.idle(runtime);
  assert.equal(proof.provider.requests.length, 1);
  const entries = proof.entries()[0]!, messages = entries.filter(entry => entry.type === 'message');
  assert(messages.some(entry => JSON.stringify(entry.message).includes(text)), 'Native user content remains literal');
  assert.equal(proof.events.some(event => event.kind === 'state' && event.observation.state === 'failed'), false);
});

test('Pi orderly stop terminates its native tool subprocess instead of leaving work running', { timeout: 60000 }, async scope => {
  const proof = await fixture(scope), runtime = await proof.start(), marker = join(proof.directory, 'owned-tool.pid');
  const source = 'require("node:fs").writeFileSync(' + JSON.stringify(marker) + ',String(process.pid));setInterval(()=>{},60000)';
  proof.provider.tool('bash', { command: 'node -e ' + JSON.stringify(source), timeout: 60 });
  await runtime.deliver('Run the inert controlled tool until the owner stops it.', 'pi-tool-close'); runtime.acknowledge(['pi-tool-close']);
  await until(() => existsSync(marker)); const pid = Number(readFileSync(marker, 'utf8')); assert(Number.isSafeInteger(pid) && pid > 1);
  const alive = () => {
    try { process.kill(pid, 0); return process.platform !== 'linux' || readFileSync('/proc/' + pid + '/stat', 'utf8').split(') ')[1]?.[0] !== 'Z'; }
    catch (error) { if (error && typeof error === 'object' && 'code' in error && ['ENOENT', 'ESRCH'].includes(String(error.code))) return false; throw error; }
  };
  cleanup(scope, () => { if (alive()) process.kill(pid, 'SIGKILL'); });
  await runtime.close(); await until(() => !alive(), 'Pi native shell child survived orderly close');
  assert.equal(proof.provider.requests.length, 1, 'Stop does not run another model turn');
});
