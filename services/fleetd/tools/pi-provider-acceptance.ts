import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { piRuntime } from '@ctlflow/crossfire-adapter-pi/owned';
import { nativeClock } from '@ctlflow/crossfire-adapter-runtime/clock';
import { writeJson } from '@ctlflow/crossfire-adapter-filesystem/index';
import type { OwnedRuntimeConnection } from '@ctlflow/crossfire-agent-core/owned-runtime';
import type { RuntimeConnection, RuntimeHooks, RuntimeObservationEvent } from '@ctlflow/crossfire-agent-core/runtime';
import type { UsageSample } from '@ctlflow/crossfire-contracts/statistics';
import { failure, failureError, success, type Result } from '@ctlflow/crossfire-kernel/result';
import { options, runTool, textOption } from '@ctlflow/crossfire-operator-support/command';
import { createNativeLifecycle, type NativeLifecycleServices } from '@ctlflow/fleetd-domain/native-lifecycle';
import { createResumeWork } from '@ctlflow/fleetd-storage/resume-work';

export type PiProviderPlan = { binary: string; provider: string; model: string; thinkingLevel: string; evidence: string };
type Managed = Extract<Awaited<ReturnType<typeof createNativeLifecycle>>, { ok: true }>['value'];
type ProofReport = { provider: string; model: string; thinkingLevel: string; platform: string; startedAt: string;
  checks: { name: string; elapsedMs: number }[]; sharedActivations: number; modelResponses: number; nativeFailures: number;
  readyTransitions: number; usage: UsageSample[]; privateStateRemoved: boolean; status: 'running' | 'passed' | 'failed'; phase: string };
const usage = 'Pi provider acceptance: --binary PATH --provider ID --model ID --thinking-level LEVEL --evidence PRIVATE_DIRECTORY --execute\nStarts real model requests in a disposable synthetic workspace. Uses the native Pi login or environment. Never targets a registered fleet.';

function value<Value>(result: Result<Value>): Value { if (!result.ok) throw failureError(result.error); return result.value; }
function requireProof(condition: unknown, label: string): asserts condition { if (!condition) throw new Error(label); }
function privateDirectory(directory: string): void {
  const info = lstatSync(directory);
  requireProof(isAbsolute(directory) && realpathSync(directory) === resolve(directory) && info.isDirectory() && !info.isSymbolicLink()
    && info.uid === process.getuid!() && !(info.mode & 0o077), 'Evidence must be an existing canonical private owned directory');
}

export async function verifyPiProvider(plan: PiProviderPlan, signal: AbortSignal): Promise<Result<ProofReport>> {
  if (process.platform !== 'linux') return failure('unavailable', 'This native process-recovery acceptance requires Linux');
  const adapter = piRuntime(plan.binary), nativeOptions = { provider: plan.provider, model: plan.model, thinking_level: plan.thinkingLevel };
  const parsed = adapter.validate(nativeOptions); if (!parsed.ok) return parsed;
  try { signal.throwIfAborted(); privateDirectory(plan.evidence); requireProof(isAbsolute(plan.binary), 'Pi binary must be an absolute path'); }
  catch { return failure('invalid', 'Pi acceptance requires a live signal, absolute binary and canonical private evidence directory'); }
  const report: ProofReport = { provider: plan.provider, model: plan.model, thinkingLevel: plan.thinkingLevel, platform: process.platform,
    startedAt: new Date().toISOString(), checks: [], sharedActivations: 0, modelResponses: 0, nativeFailures: 0, readyTransitions: 0, usage: [],
    privateStateRemoved: false, status: 'running', phase: 'startup' };
  const root = mkdtempSync(join(plan.evidence, 'pi-provider-')), reportFile = join(plan.evidence, 'pi-provider-' + randomUUID() + '.json');
  const workspace = join(root, 'workspace'), sharedState = join(root, 'shared'), roomState = join(root, 'rooms');
  for (const directory of [workspace, sharedState, roomState]) mkdirSync(directory, { mode: 0o700 });
  const stop = new AbortController(), scope = AbortSignal.any([signal, stop.signal, AbortSignal.timeout(240000)]);
  const disposers: (() => Promise<void>)[] = [], observations: RuntimeObservationEvent[] = [], latest = new Map<string, UsageSample>();
  let pendingQuestion = false, answer: 'none' | 'choice' | 'text' | 'blocked' = 'none', text = '', questionCount = 0;
  let shared: Managed, allowNewHistory = true;
  const fact = 'MEMORY_' + randomUUID().replaceAll('-', ''), ownerAnswer = 'OWNER_' + randomUUID().replaceAll('-', '');
  const instructions = 'Isolated synthetic Pi verification. Use only explicitly requested tools in this workspace; never inspect credentials, config, private state or other directories. Do not browse or make network requests. Keep answers below 100 words. For reply-only requests, use no tools. Answer memory requests only from this conversation, not files. Never repeat completed operations after restart.';
  function owned(close: () => void | Promise<void>) {
    let closed = false;
    const dispose = async () => { if (!closed) { await close(); closed = true; } };
    disposers.push(dispose); return dispose;
  }
  function save(): void { report.usage = [...latest.values()]; writeJson(reportFile, report); }
  const hooks: RuntimeHooks = {
    observe(event) { observations.push(event); if (event.kind === 'output') { text += event.text; if (Buffer.byteLength(text) > 1024 * 1024) stop.abort(new Error('Acceptance output budget exceeded')); } },
    usage(sample) {
      if (sample.tokens.total > (latest.get(sample.sessionId)?.tokens.total ?? 0)) report.modelResponses++;
      latest.set(sample.sessionId, sample);
      if (report.modelResponses > 32 || [...latest.values()].reduce((total, item) => total + item.tokens.total, 0) > 250000) stop.abort(new Error('Acceptance request budget exceeded'));
    },
    pendingInput: () => false, pendingDecisions: () => pendingQuestion,
    async requestDecision(decision, questionSignal) {
      requireProof(decision.runtime === 'pi' && decision.session && decision.turn && decision.request && decision.questions?.length === 1, 'Question lost native identity');
      questionCount++; pendingQuestion = true;
      try {
        if (answer === 'blocked') await new Promise<never>((_resolve, reject) => {
          if (questionSignal.aborted) reject(questionSignal.reason);
          else questionSignal.addEventListener('abort', () => reject(questionSignal.reason), { once: true });
        });
        const question = decision.questions[0]!;
        requireProof(answer === 'choice' && !question.allowText && question.options.map(option => option.label).join('|') === 'A|B|C'
          || answer === 'text' && question.allowText && question.options.length === 0, 'Unexpected owner question');
        return success({ answers: { [decision.request]: { answers: [answer === 'choice' ? 'B' : ownerAnswer] } } });
      } finally { pendingQuestion = false; }
    },
  };
  const services: NativeLifecycleServices = { clock: nativeClock, primary: 'shared', runtime: 'pi', approval: 'none', initial: 'running',
    initialSettings: adapter.configuredSettings(nativeOptions), hooks, work: createResumeWork(join(sharedState, 'resume-work'), Date.now),
    saved: () => adapter.savedContexts({ workspace, stateDirectory: sharedState }),
    async start(nativeSignal, observe) {
      report.sharedActivations++;
      const started = await adapter.start({ profile: 'pi-provider-proof', name: 'pi-provider-proof', workspace, stateDirectory: sharedState,
        instructions, options: nativeOptions, allowNewHistory, hooks: { ...hooks, observe } }, nativeSignal);
      if (started.ok) allowNewHistory = false;
      return started;
    },
    failed() { report.nativeFailures++; if (report.phase !== 'idle-crash-recovery') stop.abort(new Error('Unexpected native failure')); },
    recovered() { report.readyTransitions++; },
  };
  async function until(predicate: () => boolean | Promise<boolean>): Promise<void> {
    const deadline = performance.now() + 90000;
    while (!await predicate()) { scope.throwIfAborted(); requireProof(performance.now() < deadline, 'Native observation deadline exceeded'); await delay(25, undefined, { signal: scope }); }
  }
  async function check(name: string, work: () => Promise<void>): Promise<void> {
    report.phase = name; save(); const before = performance.now(); await work();
    report.checks.push({ name, elapsedMs: Math.round(performance.now() - before) }); save();
  }
  async function send(runtime: RuntimeConnection, input: string, expected: string): Promise<void> {
    text = ''; const id = randomUUID(); await runtime.deliver(input, id, scope); runtime.acknowledge([id]);
    await until(async () => !(await runtime.inspect()).busy);
    requireProof(text.includes(expected), 'Completed provider response did not match the synthetic proof');
  }
  let cleanupFailed = false;
  try {
    await check('startup', async () => {
      shared = value(await createNativeLifecycle(services, scope)); owned(shared.close); await shared.activate(); shared.runtime.lifecycle!.configureIdle(0);
      requireProof(report.modelResponses === 0, 'Startup made an unexpected model request');
      requireProof((await shared.attachment()).ok === false, 'Pi must not invent a live terminal attachment');
      const settings = observations.filter(event => event.kind === 'state').at(-1);
      requireProof(settings?.kind === 'state' && settings.observation.settings.some(setting => setting.name === 'model' && setting.effective === plan.model), 'Effective native model not verified');
    });
    const sessionId = shared!.runtime.sessionId;
    await check('response-and-native-write', async () => {
      await send(shared.runtime, 'Remember the conversation-only marker ' + fact + '. Use the write tool once to create proof.txt containing exactly TOOL_OK. Then reply with exactly ' + fact + '.', fact);
      requireProof(readFileSync(join(workspace, 'proof.txt'), 'utf8') === 'TOOL_OK', 'Native write tool did not produce exact bytes');
    });
    await check('owner-choice', async () => {
      answer = 'choice'; const before = questionCount;
      await send(shared.runtime, 'Call crossfire_question once with title "Synthetic choice", prompt "Which route?", options ["A","B","C"]. After receiving the owner answer, reply with exactly CHOICE_<answer>.', 'CHOICE_B');
      requireProof(questionCount === before + 1, 'Owner choice was not delivered exactly once'); answer = 'none';
    });
    await check('owner-text', async () => {
      answer = 'text'; const before = questionCount;
      await send(shared.runtime, 'Call crossfire_question once with title "Synthetic text", prompt "Supply the synthetic code", without options. Reply with exactly the returned owner answer.', ownerAnswer);
      requireProof(questionCount === before + 1, 'Owner text was not delivered exactly once'); answer = 'none';
    });
    await check('question-interruption', async () => {
      answer = 'blocked'; const id = randomUUID(); await shared.runtime.deliver('Call crossfire_question once with title "Await synthetic owner", prompt "Which route?", options ["A","B","C"]. Wait for the owner answer.', id, scope);
      shared.runtime.acknowledge([id]); await until(() => pendingQuestion);
      const captured = await shared.runtime.turnControl!.activeTurn(); requireProof(captured, 'Awaiting question has no active run');
      requireProof(await shared.runtime.turnControl!.interrupt(captured) === 'interrupted', 'Question run was not interrupted');
      requireProof(!pendingQuestion, 'Interrupted question still waits for an answer'); answer = 'none';
      await send(shared.runtime, 'The owner interrupted without answering. Use no tools. Reply with exactly QUESTION_STEERED.', 'QUESTION_STEERED');
      requireProof(await shared.runtime.turnControl!.interrupt(captured) === 'inactive', 'Stale capture interrupted a later run');
    });
    await check('tool-interruption', async () => {
      execFileSync('mkfifo', [join(workspace, 'wait.fifo')]); const id = randomUUID();
      await shared.runtime.deliver('Run only this exact bash command with timeout 120: printf "%s %s\\n" "$BASHPID" "$PPID" > blocked.pid; IFS= read -r < wait.fifo; printf TOOL_FINISHED. Wait for it; do not unblock the FIFO or run another tool.', id, scope);
      shared.runtime.acknowledge([id]); await until(() => existsSync(join(workspace, 'blocked.pid')));
      const pid = Number(readFileSync(join(workspace, 'blocked.pid'), 'utf8').trim().split(' ')[0]);
      requireProof(Number.isSafeInteger(pid) && pid > 1 && readlinkSync('/proc/' + pid + '/cwd') === workspace, 'Blocking tool is not owned by the proof workspace');
      const captured = await shared.runtime.turnControl!.activeTurn(); requireProof(captured, 'Blocking tool has no active run');
      requireProof(await shared.runtime.turnControl!.interrupt(captured) === 'interrupted', 'Blocking native tool was not interrupted');
      await until(() => !existsSync('/proc/' + pid));
      await send(shared.runtime, 'The owner cancelled the tool. Do not restart it or use any tools. Reply with exactly TOOL_STEERED.', 'TOOL_STEERED');
    });
    await check('idle-sleep-and-authenticated-wake', async () => {
      shared.runtime.lifecycle!.configureIdle(1); await until(() => shared.nativeState().phase === 'sleeping');
      await send(shared.runtime, 'Use no tools. Reply with exactly the MEMORY_ marker from the first request in this conversation.', fact);
      shared.runtime.lifecycle!.configureIdle(0); requireProof(shared.runtime.sessionId === sessionId, 'Sleep/wake replaced native history');
      const source = process.env.PI_CODING_AGENT_DIR;
      if (source && existsSync(join(source, 'auth.json'))) requireProof(readFileSync(join(source, 'auth.json')).equals(readFileSync(join(sharedState, '.pi/auth.json'))), 'Wake did not recopy native authentication');
    });
    await check('controller-stop-and-saved-resume', async () => {
      await shared.close(); services.initial = 'sleeping'; shared = value(await createNativeLifecycle(services, scope)); owned(shared.close);
      await shared.activate(); shared.runtime.lifecycle!.configureIdle(0);
      requireProof(shared.runtime.sessionId === sessionId, 'Controller restart replaced saved history');
      await send(shared.runtime, 'Use no tools. Reply with exactly the MEMORY_ marker from the first request in this conversation.', fact);
    });
    await check('native-process-identity', async () => {
      await send(shared.runtime, 'Run only this exact bash command: printf "%s\\n" "$PPID" > native.pid. Then reply with exactly NATIVE_PID_RECORDED.', 'NATIVE_PID_RECORDED');
    });
    await check('idle-crash-recovery', async () => {
      const pid = Number(readFileSync(join(workspace, 'native.pid'), 'utf8').trim()); requireProof(Number.isSafeInteger(pid) && pid > 1, 'Invalid owned native PID');
      const environment = readFileSync('/proc/' + pid + '/environ', 'utf8').split('\0');
      requireProof(environment.includes('PI_CODING_AGENT_DIR=' + join(sharedState, '.pi')) && environment.includes('CROSSFIRE_AGENT_NAME=pi-provider-proof'), 'Native process does not belong to the isolated proof');
      const before = report.modelResponses, ready = report.readyTransitions;
      process.kill(pid, 'SIGKILL'); await until(() => report.readyTransitions === ready + 1 && shared.nativeState().phase === 'running');
      requireProof(shared.runtime.sessionId === sessionId && report.modelResponses === before, 'Idle crash replaced history or created a model turn');
      await send(shared.runtime, 'Use no tools. Reply with exactly the MEMORY_ marker from the first request in this conversation.', fact);
      requireProof(report.nativeFailures === 1, 'Native crash did not report exactly one failure'); await shared.close();
    });
    await check('room-isolation-and-saved-room-resume', async () => {
      const input = { profile: 'pi-provider-room-proof', name: 'pi-provider-room-proof', workspace, stateDirectory: roomState, instructions,
        options: nativeOptions, hooks, allowNewHistory: true, listenerOptions: { historyMode: 'per-room' as const } };
      let runtime: OwnedRuntimeConnection = value(await adapter.start(input, scope)); let close = owned(runtime.close);
      const first = await runtime.conversation!('!proof-first:local'), second = await runtime.conversation!('!proof-second:local');
      const roomId = first.sessionId; requireProof(first.sessionId !== second.sessionId && roomId !== runtime.sessionId, 'Native room histories are not independent');
      await send(first, 'Remember the conversation-only marker ' + fact + '. Use no tools. Reply with exactly ROOM_ONE_READY.', 'ROOM_ONE_READY');
      await send(second, 'Use no tools. If a MEMORY_ marker was supplied in an earlier message in this conversation, reply with it; otherwise reply exactly UNSEEN.', 'UNSEEN');
      await close(); input.allowNewHistory = false; runtime = value(await adapter.start(input, scope)); close = owned(runtime.close);
      const resumed = await runtime.conversation!('!proof-first:local'); requireProof(resumed.sessionId === roomId, 'Room resume replaced native history');
      await send(resumed, 'Use no tools. Reply with exactly the MEMORY_ marker from the first request in this conversation.', fact); await close();
    });
    requireProof([...latest.values()].some(sample => sample.tokens.input > 0 && sample.tokens.output > 0), 'Real provider usage is missing');
    requireProof([...latest.values()].every(sample => sample.tokens.reasoningOutput === null), 'Unknown native reasoning was fabricated');
    report.status = 'passed'; report.phase = 'complete';
  } catch { report.status = 'failed'; }
  finally {
    stop.abort(new Error('Pi acceptance completed'));
    for (const close of disposers.reverse()) try { await close(); } catch { cleanupFailed = true; }
    if (!cleanupFailed) { rmSync(root, { recursive: true, force: true }); report.privateStateRemoved = true; }
    else report.status = 'failed';
    save();
  }
  return report.status === 'passed' ? success(report) : failure('native', 'Pi provider acceptance failed during ' + report.phase + '; inspect the private evidence report.');
}

export async function inspectPiProvider(arguments_: string[], signal: AbortSignal): Promise<Result<ProofReport>> {
  const parsed = options(arguments_, ['binary', 'provider', 'model', 'thinking-level', 'evidence'], [], ['execute']); if (!parsed.ok) return parsed;
  if (parsed.value.execute !== true) return failure('forbidden', 'This acceptance starts real model requests. Explicit --execute is required.');
  return verifyPiProvider({ binary: textOption(parsed.value, 'binary')!, provider: textOption(parsed.value, 'provider')!, model: textOption(parsed.value, 'model')!,
    thinkingLevel: textOption(parsed.value, 'thinking-level')!, evidence: textOption(parsed.value, 'evidence')! }, signal);
}

if (import.meta.main) {
  const arguments_ = process.argv.slice(2);
  if (!arguments_.length || arguments_[0] === '--help') process.stdout.write(usage + '\n');
  else await runTool(signal => inspectPiProvider(arguments_, signal));
}
