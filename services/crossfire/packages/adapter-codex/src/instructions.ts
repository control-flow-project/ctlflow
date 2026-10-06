import { createHash, randomUUID } from 'node:crypto';
import { lstatSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import * as check from '@ctlflow/crossfire-contracts/schema/validation';
import { object } from '@ctlflow/crossfire-contracts/validation';
import { nativeDelivery } from '@ctlflow/crossfire-adapter-runtime/delivery';
import { deliveryText, readDeliveryJournal } from '@ctlflow/crossfire-adapter-runtime/journal';
import { captureHistory, historyBoundary, historyHeader, historySince } from '@ctlflow/crossfire-adapter-runtime/native-file';
import type { CodexSession } from './session.js';

const instructionInput = check.object({ text: deliveryText,
  messageId: check.refine(check.text(100), value => value.startsWith('crossfire-instructions-')
    && check.identifier(value.slice('crossfire-instructions-'.length)).ok, 'Invalid native instruction identity'),
  path: check.text(4096), boundary: check.nullable(historyBoundary) });
type InstructionInput = check.Parsed<typeof instructionInput>;

function historyPath(home: string, path: unknown): string {
  if (typeof path !== 'string' || !isAbsolute(path) || resolve(path) !== path || path.length > 4096) {
    throw new Error('Codex must expose its exact private native history path');
  }
  const root = join(home, 'sessions'), within = relative(root, path), state = lstatSync(home);
  if (realpathSync(home) !== resolve(home) || !state.isDirectory() || state.uid !== process.getuid!() || state.mode & 0o077
    || !within || within === '..' || within.startsWith('../') || isAbsolute(within)) {
    throw new Error('Native instruction evidence must remain in this private managed history home');
  }
  let directory = dirname(path);
  for (;;) {
    try {
      const info = lstatSync(directory);
      if (!info.isDirectory() || info.uid !== process.getuid!() || realpathSync(directory) !== resolve(directory)) {
        throw new Error('Native history cannot traverse unowned or symbolic link directories');
      }
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error;
    }
    if (directory === home) break;
    directory = dirname(directory);
  }
  return path;
}

export async function applyNativeInstructions(session: CodexSession, options: { home: string; journal: string; text: string }): Promise<void> {
  const parsed = deliveryText(options.text);
  if (!parsed.ok) throw new Error(parsed.error.message);
  async function current() {
    const response = object(await session.request('thread/read', { threadId: session.sessionId, includeTurns: false }));
    const thread = response.ok ? object(response.value.thread) : response;
    const state = thread.ok ? object(thread.value.status) : thread;
    if (!thread.ok || !state.ok || thread.value.id !== session.sessionId || thread.value.canAcceptDirectInput !== true
      || !['idle', 'active'].includes(String(state.value.type)) || typeof thread.value.cwd !== 'string'
      || realpathSync(thread.value.cwd) !== session.workspace) throw new Error('Native instruction owner lost its exact loaded session and workspace');
    return { path: historyPath(options.home, thread.value.path), idle: state.value.type === 'idle' };
  }
  function header(path: string): boolean {
    const value = historyHeader(path);
    if (value === undefined) return false;
    const record = object(value), payload = record.ok ? object(record.value.payload) : record;
    if (!record.ok || record.value.type !== 'session_meta' || !payload.ok || payload.value.id !== session.sessionId
      || typeof payload.value.cwd !== 'string' || realpathSync(payload.value.cwd) !== session.workspace) {
      throw new Error('Native history does not belong to the selected instruction session');
    }
    return true;
  }
  const delivery = nativeDelivery<InstructionInput>({ sessionId: session.sessionId, approval: session.approval, signal: session.signal,
    verify: async () => { await current(); }, inspect: async () => ({ busy: !(await current()).idle }),
    prepare: async (text, messageId) => {
      const state = await current();
      if (!state.idle) throw new Error('Native instructions require an idle owned session before publication');
      const boundary = captureHistory(state.path);
      if (boundary && !header(state.path)) throw new Error('Native history header is incomplete before instruction publication');
      return { text, messageId, path: state.path, boundary };
    },
    publish: async input => {
      const state = await current();
      if (!state.idle || state.path !== input.path) throw new Error('Native instruction publication lost its prepared history');
      await session.request('thread/inject_items', { threadId: session.sessionId, items: [{ type: 'message', id: input.messageId,
        role: 'developer', content: [{ type: 'input_text', text: input.text }] }] });
    },
    received: async input => {
      if ((await current()).path !== input.path) throw new Error('Native instruction recovery changed its retained history path');
      if (!header(input.path)) return false;
      let received = 0;
      historySince(input.path, input.boundary, value => {
        const record = object(value);
        if (!record.ok) throw new Error('Invalid native history record');
        if (record.value.type !== 'response_item') return;
        const item = object(record.value.payload);
        if (!item.ok) throw new Error('Invalid native response item');
        if (item.value.id !== input.messageId) return;
        const content = Array.isArray(item.value.content) && item.value.content.length === 1 ? object(item.value.content[0]) : null;
        if (item.value.type !== 'message' || item.value.role !== 'developer' || !content?.ok
          || content.value.type !== 'input_text' || content.value.text !== input.text) throw new Error('Native developer instruction receipt differs from its submitted identity and content');
        received++;
        if (received > 1) throw new Error('Native instruction identity was appended more than once');
      });
      return received === 1;
    }, close: () => {},
  }, instructionInput, { journal: options.journal, pollMs: 100 });
  try {
    let state = readDeliveryJournal(options.journal, session.sessionId, instructionInput);
    if (state.confirmed.length > 1 || state.pending && state.confirmed.length) throw new Error('Native instructions have competing confirmed revisions');
    if (state.pending) await delivery.recover(state.pending.text, state.pending.messageId);
    state = readDeliveryJournal(options.journal, session.sessionId, instructionInput);
    const digest = createHash('sha256').update(options.text).digest('hex');
    const confirmed = state.confirmed[0];
    if (confirmed?.digest === digest) {
      if (!await delivery.recover(options.text, confirmed.messageId)) throw new Error('Native instructions lost their confirmed revision');
      return;
    }
    if (confirmed) delivery.acknowledge([confirmed.messageId]);
    await delivery.deliver(options.text, 'crossfire-instructions-' + randomUUID());
  } finally { await delivery.close(); }
}
