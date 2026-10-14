import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import type { TestContext } from 'node:test';
import { cleanup } from './cleanup.js';

export type ContractCommand = { binary: string; arguments: string[] };
export type ContractTarget = { name: string; implementation: 'node' | 'csharp' | 'rust'; server: ContractCommand; daemon: ContractCommand; cli: ContractCommand };
export type ContractProcess = { child: ChildProcess; ended: Promise<number | null>; alive(): boolean; output(): string; errors(): string; close(): Promise<void> };
export async function freePorts(): Promise<[number, number]> {
  const servers = [createServer(), createServer()];
  try { for (const server of servers) { server.listen(0, '127.0.0.1'); await once(server, 'listening'); } return servers.map(server => { const address = server.address(); assert(address && typeof address !== 'string'); return address.port; }) as [number, number]; }
  finally { for (const server of servers) if (server.listening) await new Promise<void>(resolveClose => server.close(() => resolveClose())); }
}
export function record(value: unknown): Record<string, unknown> { assert(value !== null && typeof value === 'object' && !Array.isArray(value), 'Expected a protocol object'); return value as Record<string, unknown>; }
export function text(value: unknown): string { assert.equal(typeof value, 'string', 'Expected protocol text'); return value as string; }
export function integer(value: unknown): number { assert(Number.isSafeInteger(value), 'Expected a safe protocol integer'); return value as number; }
export function list(value: unknown): unknown[] { assert(Array.isArray(value), 'Expected a protocol array'); return value; }
export function target(value: unknown): ContractTarget {
  const input = record(value); assert.deepEqual(Object.keys(input).sort(), ['cli', 'daemon', 'implementation', 'name', 'server']);
  const implementation = input.implementation; assert(implementation === 'node' || implementation === 'csharp' || implementation === 'rust');
  function command(value: unknown): ContractCommand { const row = record(value); assert.deepEqual(Object.keys(row).sort(), ['arguments', 'binary']); return { binary: text(row.binary), arguments: list(row.arguments).map(text) }; }
  const name = text(input.name); assert.match(name, /^[a-z][a-z0-9-]{0,63}$/u); return { name, implementation, server: command(input.server), daemon: command(input.daemon), cli: command(input.cli) };
}
export async function observe(predicate: () => boolean | Promise<boolean>, message: string, milliseconds = 30000): Promise<void> {
  const deadline = Date.now() + milliseconds;
  for (;;) { if (await predicate()) return; assert(Date.now() < deadline, message); await delay(25); }
}
export function contractProcess(context: TestContext, command: ContractCommand, args: string[], cwd: string, env: NodeJS.ProcessEnv = process.env): ContractProcess {
  const child = spawn(command.binary, [...command.arguments, ...args], { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', errors = '', failed: Error | undefined, closing: Promise<void> | undefined, exited = false;
  child.stdout?.on('data', (bytes: Buffer) => { output = (output + bytes.toString('utf8')).slice(-65536); }); child.stderr?.on('data', (bytes: Buffer) => { errors = (errors + bytes.toString('utf8')).slice(-65536); }); child.once('error', error => { failed = error; });
  const ended = new Promise<number | null>(resolveExit => child.once('close', code => { exited = true; resolveExit(code); }));
  function signal(signal: NodeJS.Signals): void { if (child.pid !== undefined) try { process.kill(-child.pid, signal); } catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error; } }
  const close = () => closing ??= (async () => { if (!exited) { signal('SIGTERM'); const timer = setTimeout(() => { signal('SIGKILL'); child.stdout?.destroy(); child.stderr?.destroy(); }, 10000); try { await ended; } finally { clearTimeout(timer); } } if (failed) throw failed; })(); cleanup(context, close);
  return { child, ended, alive: () => !exited && failed === undefined && child.exitCode === null && child.signalCode === null, output: () => output, errors: () => failed?.message ?? errors, close };
}
