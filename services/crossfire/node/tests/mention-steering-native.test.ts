import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import { trustWorkspace } from '@ctlflow/crossfire-test-support/codex';
import { nativeProvider } from '@ctlflow/crossfire-test-support/native-provider';
import { value } from '@ctlflow/crossfire-test-support/result';
import { codexRuntime } from '@ctlflow/crossfire-adapter-codex/owned';
import { listen } from '@ctlflow/crossfire-adapter-crossfire/listener';
import type { RuntimeAdapter } from '@ctlflow/crossfire-agent-core/runtime';
import type { OwnedRuntimeConnection } from '@ctlflow/crossfire-agent-core/owned-runtime';
import { matrixFixture, message, mention, ROOM, SELF, temporary, until } from '../scripts/test-support/listener.js';
import { executeOperation, selectOperation } from '@ctlflow/crossfire-adapter-matrix/commands';
import { matrix as matrixClient } from '@ctlflow/crossfire-adapter-matrix/http';

for (const historyMode of ['shared', 'per-room'] as const) for (const sourceKind of ['human', 'agent'] as const) {
  test('stock Codex ' + sourceKind + ' mention steering preserves ' + historyMode + ' histories without a replacement engine', { timeout: 60_000 }, async scope => {
    const workspace = temporary(scope), home = join(workspace, '.codex');
    mkdirSync(home, { mode: 0o700 }); writeFileSync(join(home, 'auth.json'), '{}', { mode: 0o600 });
    const provider = await nativeProvider(scope, home); trustWorkspace(home, workspace);
    const adapter = codexRuntime(process.env.CROSSFIRE_TEST_CODEX ?? 'codex');
    const matrix = await matrixFixture(scope, workspace), other = '!other:test.localhost'; matrix.subscribe(other);
    const sender = sourceKind === 'agent' ? '@agent-holmes:test.localhost' : matrix.settings.owner;
    if (sourceKind === 'agent') matrix.extraMembers.add(sender);
    const stop = new AbortController();
    let native: OwnedRuntimeConnection | undefined, failure: unknown;
    const runtime: RuntimeAdapter = async (signal, _pollMs, hooks) => {
      native = value(await adapter.start({ workspace, stateDirectory: workspace, profile: 'steering-proof', name: 'steering-proof',
        allowNewHistory: true, instructions: 'Inert native mention steering verification.', options: {}, listenerOptions: { historyMode }, hooks }, signal));
      return native;
    };
    const result = listen({ ...matrix, runtime, historyMode, limit: 20, reconcileMs: 30000, pollMs: 100, debounceMs: 0 }, stop.signal)
      .catch(error => { failure = error; return error; });
    cleanup(scope, async () => { stop.abort(new Error('verification complete')); await result; });
    const check = (predicate: () => boolean | Promise<boolean>) => until(async () => {
      if (failure) throw failure;
      return await predicate();
    }, 'Stock native steering did not reach its verified boundary', 15000);
    await check(() => native !== undefined && existsSync(matrix.cursorFile) && matrix.waiting() === 1);
    const current = native!;
    const selected = historyMode === 'per-room' ? await current.conversation!(ROOM) : current;
    const peer = historyMode === 'per-room' ? await current.conversation!(other) : undefined;
    const selectedSession = selected.sessionId;
    const before = (await current.attachments()).map(entry => [entry.context, entry.attachment.sessionId]);
    await selected.deliver('Keep the historical evidence: cobalt orchard 492.', 'retained-evidence');
    selected.acknowledge(['retained-evidence']);
    await check(() => provider.held() !== undefined);
    const captured = await current.turnControl.activeTurn(historyMode === 'per-room' ? ROOM : undefined); assert(captured);
    if (peer) {
      matrix.add(other, mention('$other-room', sender, 'Inspect this other room only.'));
      await check(() => provider.requests.some(request => JSON.stringify(request).includes('$other-room')));
      await check(() => JSON.parse(readFileSync(matrix.cursorFile, 'utf8'))[other] === '1');
      assert.equal(await current.turnControl.activeTurn(ROOM), captured, 'Another room cannot cancel this busy history');
      assert(!JSON.stringify(provider.requests.at(-1)).includes('cobalt orchard 492'), 'Room history isolation remains native');
      await check(async () => await current.turnControl.activeTurn(other) === null);
      provider.hold();
      await peer.deliver('Keep the other historical evidence: sienna lighthouse 275.', 'other-retained-evidence');
      peer.acknowledge(['other-retained-evidence']);
      await check(() => provider.held() !== undefined);
      assert(await current.turnControl.activeTurn(other));
    }
    const received = provider.requests.length;
    if (peer) matrix.add(ROOM, message('$ordinary-backlog', '@context:test.localhost'));
    const redirect = 'Stop the old task and inspect the replacement evidence.';
    if (sourceKind === 'agent') {
      await executeOperation(matrixClient({ base: matrix.settings.server, token: matrix.account.accessToken }),
        matrix.settings, matrix.account, selectOperation('send-message'), { 'room-id': ROOM, 'event-type': 'm.room.message',
          'txn-id': 'native-agent-redirect', 'mention-user': SELF, markdown: redirect });
      const sent = matrix.requests.find(request => request.path.endsWith('/native-agent-redirect'))!;
      matrix.add(ROOM, { ...message('$native-mention-steer', sender, redirect), content: sent.body as ReturnType<typeof message>['content'] });
    } else matrix.add(ROOM, mention('$native-mention-steer', sender, redirect));
    const expectedCursor = String(matrix.rooms.get(ROOM)!.length);
    if (peer) matrix.add(other, mention('$native-other-steer', sender, 'Inspect the other replacement evidence.'));
    const replacements = peer ? 2 : 1;
    await check(() => {
      assert(provider.requests.length <= received + replacements, 'Steering cannot replay native input');
      return provider.requests.length === received + replacements;
    });
    const redirected = provider.requests.slice(received).map(request => JSON.stringify(request));
    const instruction = redirected.find(request => request.includes('$native-mention-steer'))!;
    assert(instruction, 'Every room retains its own urgent instruction');
    assert(instruction.includes('$native-mention-steer'));
    assert(instruction.includes('Stop the old task and inspect the replacement evidence.'));
    assert(instruction.includes('cobalt orchard 492'), 'Esc-plus-input retains the earlier native history');
    assert(instruction.includes(ROOM));
    assert(!instruction.includes('$ordinary-backlog'), 'Urgent input precedes unacknowledged context');
    if (peer) {
      const otherInstruction = redirected.find(request => request.includes('$native-other-steer'))!;
      assert(otherInstruction); assert(otherInstruction.includes('sienna lighthouse 275'));
      assert(!otherInstruction.includes('cobalt orchard 492')); assert(!instruction.includes('sienna lighthouse 275'));
      await check(() => {
        const state = JSON.parse(readFileSync(matrix.cursorFile + '.control', 'utf8')) as { controls: { event: string; status: string }[] };
        return ['$native-mention-steer', '$native-other-steer'].every(id => state.controls.some(control => control.event === id && control.status === 'delivered'));
      });
      assert.equal(JSON.parse(readFileSync(matrix.cursorFile, 'utf8'))[ROOM], 'sync-0', 'Urgent receipts do not mark the earlier backlog read');
    } else await check(() => JSON.parse(readFileSync(matrix.cursorFile, 'utf8'))[ROOM] === expectedCursor);
    assert.deepEqual((await current.attachments()).map(entry => [entry.context, entry.attachment.sessionId]), before);
    assert.equal(selected.sessionId, selectedSession);
    assert.equal(provider.requests.length, received + replacements, 'Routing and cancellation make no model call; each new task reaches the inert provider once');
  });
}
