import { realpathSync, existsSync, mkdirSync, lstatSync, writeFileSync, renameSync, unlinkSync, readFileSync, openSync, closeSync, fsyncSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { readJson } from '@crossfire/adapter-filesystem/index';
import type { RuntimeAdapter } from '@crossfire/agent-core/runtime';
import { nativeDelivery } from '@crossfire/adapter-runtime/delivery';
import { deliveryText } from '@crossfire/adapter-runtime/journal';
import { piDescriptor, piBoundary, piCall, type PiDescriptor } from './protocol.js';
import { setTimeout as delay } from 'node:timers/promises';
import { artifactHash } from '@crossfire/adapter-filesystem/release';
import { ignoreProjectPaths } from '@crossfire/adapter-filesystem/project';
import type { RuntimeHooks } from '@crossfire/agent-core/runtime';
import * as check from '@crossfire/contracts/schema/validation';

const projectEntry = `import { realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
export default async function crossfire(api) {
  const client = realpathSync(join(dirname(fileURLToPath(import.meta.url)), '../../.crossfire/client.mjs'));
  const runtime = await import(pathToFileURL(join(dirname(client), 'crossfire-pi.mjs')).href);
  runtime.default(api);
}
`;

export function installPiExtension(workspace: string): void {
  const root = join(workspace, '.pi'), directory = join(root, 'extensions');
  if (!existsSync(root)) mkdirSync(root, { mode: 0o700 });
  const parent = lstatSync(root);
  if (!parent.isDirectory() || parent.uid !== process.getuid!() || realpathSync(root) !== root) throw new Error('Pi extension must stay in this owned project');
  if (!existsSync(directory)) mkdirSync(directory, { mode: 0o700 });
  const information = lstatSync(directory);
  if (!information.isDirectory() || realpathSync(directory) !== directory || information.uid !== process.getuid!()) throw new Error('Pi extension must stay in this owned project');
  ignoreProjectPaths(workspace, ['.pi/extensions/crossfire.js']);
  const file = join(directory, 'crossfire.js');
  try {
    const info = lstatSync(file);
    if (!info.isFile() || info.uid !== process.getuid!() || info.size !== Buffer.byteLength(projectEntry)
      || readFileSync(file, 'utf8') !== projectEntry) throw new Error('A non-managed Pi extension already occupies crossfire.js; it was not replaced');
    return;
  } catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
  const temporary = join(directory, '.crossfire-' + randomUUID());
  try {
    const descriptor = openSync(temporary, 'wx', 0o600);
    try { writeFileSync(descriptor, projectEntry); fsyncSync(descriptor); } finally { closeSync(descriptor); }
    renameSync(temporary, file);
    const parent = openSync(directory, 'r');
    try { fsyncSync(parent); } finally { closeSync(parent); }
  }
  finally { if (existsSync(temporary)) unlinkSync(temporary); }
}

export async function connectPi(descriptor: PiDescriptor, journal: string, pollMs: number, stop: AbortSignal, hooks?: RuntimeHooks) {
  const stopped = new AbortController(), signal = AbortSignal.any([stop, stopped.signal]);
  const verify = async () => { if (await piCall(descriptor, { method: 'verify' }, signal) !== true) throw new Error('Pi native attachment is unavailable'); };
  await verify(); signal.throwIfAborted();
  const boundary = piBoundary(await piCall(descriptor, { method: 'boundary' }, signal));
  if (!boundary.ok) throw new Error(boundary.error.message);
  let cursor = boundary.value.leaf;
  let observed: boolean | undefined;
  const observation = check.object({ cursor: check.nullable(check.text(200)), busy: check.boolean,
    output: check.list(check.object({ id: check.text(255), text: check.plainText(8 * 1024 * 1024) }), 1024) });
  const observe = async () => {
    const result = observation(await piCall(descriptor, { method: 'observe', after: cursor }, signal));
    if (!result.ok) throw new Error(result.error.message);
    for (const output of result.value.output) hooks?.observe?.({ kind: 'output', sessionId: descriptor.session, streamId: null, ...output });
    cursor = result.value.cursor;
    if (observed !== result.value.busy) {
      observed = result.value.busy;
      hooks?.observe?.({ kind: 'state', observation: { roomId: null, sessionId: descriptor.session, runtime: 'pi', state: observed ? 'working' : 'idle', observedAt: Date.now(), settings: [], errorMessage: null } });
    }
  };
  await observe();
  let checking = false;
  const timer = setInterval(() => {
    if (checking) return;
    checking = true;
    void observe().catch(error => {
      hooks?.observe?.({ kind: 'state', observation: { roomId: null, sessionId: descriptor.session, runtime: 'pi', state: 'failed', observedAt: Date.now(), settings: [], errorMessage: String(error).slice(0, 4000) } });
      stopped.abort(error);
    }).finally(() => { checking = false; });
  }, 1000);
  const clear = () => { clearInterval(timer); signal.removeEventListener('abort', clear); };
  signal.addEventListener('abort', clear, { once: true });
  try {
    const connection = nativeDelivery({ sessionId: descriptor.session, approval: 'runtime', signal, verify,
      inspect: async () => {
        await verify();
        const active = await piCall(descriptor, { method: 'active' }, signal);
        if (active !== null && typeof active !== 'string') throw new Error('Invalid Pi operation identity');
        return { busy: active !== null };
      },
      prepare: async (text, messageId) => { const parsed = piBoundary(await piCall(descriptor, { method: 'boundary' }, signal)); if (!parsed.ok) throw new Error('Invalid Pi publication boundary'); return { text, messageId, boundary: parsed.value }; },
      publish: input => piCall(descriptor, { method: 'publish', ...input }, signal).then(() => {}),
      received: async input => { const result = await piCall(descriptor, { method: 'received', ...input }, signal); if (typeof result !== 'boolean' && result !== 'cancelled' && result !== 'waiting') throw new Error('Invalid Pi native receipt'); return result; },
      cancel: async input => { const result = await piCall(descriptor, { method: 'cancel', messageId: input.messageId, text: input.text }, signal); if (typeof result !== 'boolean') throw new Error('Invalid Pi native cancellation'); return result; },
      close: () => { clear(); stopped.abort(new Error('Pi listener disconnected')); },
    }, check.object({ text: deliveryText, messageId: check.text(200), boundary: piBoundary }), { journal, pollMs });
    return { ...connection, turnControl: {
      activeTurn: async (): Promise<string | null> => { const value = await piCall(descriptor, { method: 'active' }, signal); if (value !== null && typeof value !== 'string') throw new Error('Invalid Pi operation identity'); return value; },
      interrupt: async (turn: string, recovery = false) => {
        await piCall(descriptor, { method: 'interrupt', turn, recovery }, signal);
        const deadline = performance.now() + 5000;
        while (await piCall(descriptor, { method: 'active' }, signal) === turn) {
          if (performance.now() >= deadline) throw new Error('Pi cancellation remains uncertain; refusing replacement input');
          await delay(100, undefined, { signal });
        }
      },
    } };
  } catch (error) { clear(); stopped.abort(error); throw error; }
}

export function discoverPi(workspace: string, environment: NodeJS.ProcessEnv = process.env) {
  const file = environment.CROSSFIRE_PI_CONNECTION;
  if (!file) throw new Error('Pi native connection is not ready. Run agent connect to install its verified project extension; if already installed, use /reload in this Pi session, then reconnect. No server address or secret needs copying.');
  const parsed = piDescriptor(readJson<unknown>(file));
  if (!parsed.ok || parsed.value.workspace !== realpathSync(workspace)) throw new Error('Pi native attachment belongs to another project');
  const descriptor = parsed.value;
  const current = join(dirname(realpathSync(join(workspace, '.crossfire/client.mjs'))), 'crossfire-pi.mjs');
  if (descriptor.software !== artifactHash(readFileSync(current))) throw new Error('The Pi native extension needs this verified update. Use /reload once in Pi, then reconnect; the existing identity is unchanged.');
  const binding = createHash('sha256').update(JSON.stringify(descriptor)).digest('hex');
  const runtime: RuntimeAdapter = (stop, pollMs, hooks) => connectPi(descriptor, join(workspace, '.crossfire/runtime/pi', descriptor.session + '.receipt'), pollMs, stop, hooks);
  return { name: 'pi', session: descriptor.session, binding, runtime };
}
