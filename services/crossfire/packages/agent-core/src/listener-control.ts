import * as check from '@crossfire/contracts/schema/validation';
import type { LocalState } from './port.js';
import type { RuntimeConnection } from './runtime.js';

export type DirectedInput = { messageId: string; text: string; expiresAt: number };
export type ControllerState = { connected: boolean; deliveryEnabled: boolean; revision: number | null; error: string | null };
export type ListenerControl = {
  current(): { active: boolean; signal: AbortSignal; input: DirectedInput | null };
  subscribe(changed: () => void): () => void;
  unavailable(reason: string): void;
  acknowledge(messageId: string, status: 'delivered' | 'skipped', errorMessage: string | null): Promise<void>;
};
export function createListenerControl(acknowledge: ListenerControl['acknowledge'], unavailable?: (reason: string) => void) {
  let active = false, input: DirectedInput | null = null, generation = new AbortController();
  generation.abort(new Error('Controller delivery is inactive'));
  const observers = new Set<() => void>();
  const connection: ListenerControl = { current: () => ({ active, signal: generation.signal, input }), acknowledge,
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
const savedInput = check.object({ sessionId: check.text(200), input: check.object({ messageId: check.text(200), text: check.plainText(98304), expiresAt: check.integer() }),
  stage: check.choice('queued', 'publishing', 'delivered') });
export function controlledPublisher(storage: LocalState, file: string, control: ListenerControl, runtime: RuntimeConnection) {
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
        saved = { sessionId: runtime.sessionId, input: incoming, stage: 'queued' };
        const parsed = savedInput(saved);
        if (!parsed.ok || Buffer.byteLength(incoming.text) > 98304) throw new Error('Invalid controller input');
        storage.write(file, saved);
      }
      if (saved.stage !== 'delivered' && saved.input.expiresAt <= Date.now()) {
        if (saved.stage === 'publishing') throw new Error('Expired controller publication requires exact receipt recovery; it cannot be assumed absent or resubmitted');
        await control.acknowledge(saved.input.messageId, 'skipped', 'Message expired before publication');
        storage.remove(file); return;
      }
      if (saved.stage !== 'delivered') {
        signal.throwIfAborted();
        saved.stage = 'publishing'; storage.write(file, saved);
        await runtime.deliver(saved.input.text, saved.input.messageId, signal);
        saved.stage = 'delivered'; storage.write(file, saved);
      }
      await control.acknowledge(saved.input.messageId, 'delivered', null);
      runtime.acknowledge([saved.input.messageId]);
      storage.remove(file);
    },
  };
}
