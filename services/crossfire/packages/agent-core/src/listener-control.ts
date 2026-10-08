import * as check from '@ctlflow/crossfire-contracts/schema/validation';
import type { LocalState } from './port.js';
import type { RuntimeConnection } from './runtime.js';
import type { MessageArtifacts } from './message-artifacts.js';
import type { DirectedInput, ListenerControl } from './listener-control-port.js';
export function createListenerControl(acknowledge: ListenerControl['acknowledge'], binding: ListenerControl['binding'], unavailable?: (reason: string) => void) {
  let active = false, input: DirectedInput | null = null, generation = new AbortController();
  generation.abort(new Error('Controller delivery is inactive'));
  const observers = new Set<() => void>();
  const connection: ListenerControl = { current: () => ({ active, signal: generation.signal, input }), binding, acknowledge,
    unavailable(reason) { update({ active: false, input }); unavailable?.(reason); },
    subscribe(changed) { observers.add(changed); return () => { observers.delete(changed); }; } };
  function update(next: { active: boolean; input: DirectedInput | null }): void {
    const different = active !== next.active || input?.messageId !== next.input?.messageId || input?.text !== next.input?.text;
    if (active && !next.active) generation.abort(new Error('Controller connection or fleet delivery became inactive'));
    if (!active && next.active) generation = new AbortController();
    active = next.active; input = next.input;
    if (different) for (const changed of [...observers]) changed();
  }
  return { connection, update, close: () => update({ active: false, input: null }) };
}
export async function waitForActivation(control: ListenerControl, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  if (control.current().active) return;
  await new Promise<void>(resolve => {
    const finish = () => { unsubscribe(); signal.removeEventListener('abort', finish); resolve(); };
    const unsubscribe = control.subscribe(() => { if (control.current().active) finish(); });
    signal.addEventListener('abort', finish, { once: true });
    if (control.current().active || signal.aborted) finish();
  });
  signal.throwIfAborted();
}
const directedInput = check.object({ messageId: check.text(200), text: check.plainText(98304), expiresAt: check.integer() });
const savedInput = check.object({ sessionId: check.text(200), input: directedInput,
  text: check.plainText(98304), stage: check.choice('queued', 'publishing', 'delivered') });
export function controlledPublisher(options: { storage: LocalState; file: string; control: ListenerControl; runtime: RuntimeConnection; artifacts: MessageArtifacts; maximum: number }) {
  const { storage, file, control, runtime, artifacts } = options;
  function load() {
    if (!storage.exists(file)) return null;
    const parsed = savedInput(storage.read<unknown>(file));
    if (!parsed.ok || parsed.value.sessionId !== runtime.sessionId || Buffer.byteLength(parsed.value.input.text) > 98304) throw new Error('Invalid or retargeted controller input checkpoint');
    return parsed.value;
  }
  return {
    pending: () => storage.exists(file) || control.current().input !== null,
    async publish(signal: AbortSignal): Promise<void> {
      const incoming = control.current().input;
      let saved = load();
      if (!saved) {
        if (!incoming) return;
        const parsed = directedInput(incoming);
        if (!parsed.ok || Buffer.byteLength(incoming.text) > 98304) throw new Error('Invalid controller input');
        saved = { sessionId: runtime.sessionId, input: incoming, text: artifacts.input(incoming.text, incoming.messageId, options.maximum, { kind: 'controller-input', expiresAt: incoming.expiresAt }), stage: 'queued' };
        storage.write(file, saved);
      }
      if (saved.stage === 'publishing') {
        signal.throwIfAborted();
        saved.stage = await runtime.recover(saved.text, saved.input.messageId, signal) ? 'delivered' : 'queued';
        storage.write(file, saved);
      }
      if (saved.stage !== 'delivered' && saved.input.expiresAt <= Date.now()) {
        await control.acknowledge(saved.input.messageId, 'skipped', 'Message expired before publication', signal);
        artifacts.release([saved.input.messageId]);
        storage.remove(file); return;
      }
      if (saved.stage !== 'delivered') {
        signal.throwIfAborted();
        if (saved.stage === 'queued') saved.text = artifacts.input(saved.input.text, saved.input.messageId, options.maximum, { kind: 'controller-input', expiresAt: saved.input.expiresAt });
        saved.stage = 'publishing'; storage.write(file, saved);
        await runtime.deliver(saved.text, saved.input.messageId, signal);
        saved.stage = 'delivered'; storage.write(file, saved);
      }
      await control.acknowledge(saved.input.messageId, 'delivered', null, signal);
      runtime.acknowledge([saved.input.messageId]);
      artifacts.release([saved.input.messageId]);
      storage.remove(file);
    },
  };
}
