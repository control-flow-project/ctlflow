import { cleanup } from '@crossfire/test-support/cleanup';
import type { TestContext } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { nativeProvider } from './native-provider.js';
import { codexDelivery, type CodexConnection } from '@crossfire/adapter-codex/connection';
import { connectSession } from '@crossfire/adapter-codex/session';
import { nativeEngine, materialize } from './native-engine.js';
import type { NativeEvent } from '@crossfire/adapter-codex/protocol';

type Rpc = { method: string; params: Record<string, unknown> };

export async function nativeCodex(context: TestContext) {
  const binary = process.env.CROSSFIRE_TEST_CODEX ?? 'codex';
  console.log(execFileSync(binary, ['--version'], { encoding: 'utf8' }).trim());
  mkdirSync(join(process.cwd(), '.temp'), { recursive: true });
  const directory = mkdtempSync(join(process.cwd(), '.temp/crossfire-native-'));
  const home = join(directory, 'home'); mkdirSync(home);
  const workspace = join(directory, 'workspace'); mkdirSync(workspace);
  const provider = await nativeProvider(context, home);
  const fixture = await nativeEngine(context, home, workspace);
  await materialize(fixture, provider);
  const stop = new AbortController();
  const notifications: NativeEvent[] = [];
  const relayRequests: Rpc[] = [];
  const historyQueries: { method: string; params: unknown; result: unknown }[] = [];
  const acknowledgements: { params: Record<string, unknown>; turn: { id: string } }[] = [];
  let adapter: CodexConnection | undefined;
  const session = await connectSession({ ...fixture, timeoutMs: 10_000 }, stop.signal, {
    requestDecision: async () => { throw new Error('Unexpected permission in inert native delivery fixture'); },
  }, notice => { notifications.push(notice); adapter?.event(notice); });
  cleanup(context, async () => {
    stop.abort(); if (adapter) await adapter.close(); else await session.close();
  });
  adapter = codexDelivery({ ...session, request: async (method, params) => {
    const input = params as Record<string, unknown>;
    relayRequests.push({ method, params: input });
    const result = await session.request(method, params);
    if (method === 'turn/start') acknowledgements.push({ params: input, turn: (result as { turn: { id: string } }).turn });
    if (method.endsWith('/list')) historyQueries.push({ method, params, result });
    return result;
  } }, { pollMs: 100, timeoutMs: 10_000, receiptFile: fixture.receiptFile });
  await adapter.verify();
  const connection = adapter;
  const call = async (method: string, params: unknown) => await session.request(method, params) as Record<string, unknown>;
  return {
    adapter: connection,
    runtime: async (signal: AbortSignal) => {
      const close = () => { void session.close(); };
      signal.addEventListener('abort', close, { once: true });
      cleanup(context, () => signal.removeEventListener('abort', close));
      signal.throwIfAborted();
      return connection;
    },
    workspace, thread: { id: session.sessionId }, call, requests: provider.requests, notifications,
    relayRequests, historyQueries, acknowledgements: () => acknowledgements,
    completed: () => notifications.filter(event => event.method === 'turn/completed').length,
    held: provider.held, hold: provider.hold, finish: provider.finish, tool: provider.tool,
  };
}
