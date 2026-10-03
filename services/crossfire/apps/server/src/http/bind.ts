import type { FleetActor } from '@crossfire/domain/fleet/authority';
import { failure, success, type Result } from '@crossfire/kernel/result';
import type { Operation } from '@crossfire/contracts/rest/operation';
import type { Page } from '@crossfire/domain/port/directory';
import type { Actor, Services } from '@crossfire/domain/port/services';
import type { Manifest } from '@crossfire/contracts/release';
import type { MemberRecord } from '@crossfire/domain/port/directory';
import type { createFleetChanges } from './fleet-changes.js';
export type Metadata = { page: number; pageSize: number; totalItems: number; totalPages: number };
export type Reply = { data: unknown; pagination?: Metadata; cookie?: string | null; invitationCookie?: string };
export type Context = { services: Services; requestId: string; actor: Actor | null; manifest: Manifest;
  signal: AbortSignal; fleetChanges: ReturnType<typeof createFleetChanges>;
  controller?: Extract<FleetActor, { kind: 'controller' }>;
  session: { member: MemberRecord; csrfSecret: string; permissions: string[] } | null; credential: string };
export type Endpoint = {
  method: string; path: string; auth: 'public' | 'human' | 'agent' | 'either' | 'fleet'; status: number; collection: boolean;
  requestBytes?: number;
  match(pathname: string): Record<string, string> | null;
  invoke(context: Context, params: unknown, query: URLSearchParams, input: unknown): Promise<Result<Reply>>;
};
export function bind<Params, Query, Input, Output>(operation: Operation<Params, Query, Input, Output>,
  handler: (context: Context, params: Params, query: Query, input: Input) => Promise<Result<Reply>> | Result<Reply>): Endpoint {
  const keys: string[] = [];
  const expression = new RegExp('^' + operation.path.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
    .replace(/\\\{([A-Za-z]+)\\\}/gu, (_match, key: string) => { keys.push(key); return '([^/]+)'; }) + '$', 'u');
  return { method: operation.method, path: operation.path, auth: operation.auth, status: operation.status, collection: operation.collection,
    ...(operation.requestBytes === undefined ? {} : { requestBytes: operation.requestBytes }),
    match(pathname) {
      const matched = expression.exec(pathname);
      if (!matched) return null;
      const params: Record<string, string> = {};
      try {
        for (let index = 0; index < keys.length; index++) {
          const part = matched[index + 1]!;
          params[keys[index]!] = decodeURIComponent(part);
        }
      } catch { return null; }
      return params;
    },
    async invoke(context, rawParams, rawQuery, rawInput) {
      const params = operation.params(rawParams), query = operation.query(rawQuery), input = operation.input(rawInput);
      if (!params.ok) return params; if (!query.ok) return query; if (!input.ok) return input;
      const result = await handler(context, params.value, query.value, input.value);
      if (!result.ok) return result;
      const validated = operation.output(result.value.data);
      if (!validated.ok) throw new Error('Invalid response for ' + operation.method + ' ' + operation.path + ': ' + validated.error.message);
      if (operation.collection !== (result.value.pagination !== undefined)) throw new Error('Response pagination contract mismatch');
      return success({ ...result.value, data: validated.value });
    },
  };
}
export function actor(context: Context): Actor {
  if (!context.actor) throw new Error('Authenticated route invoked without actor');
  return context.actor;
}
export function reply<Value>(result: Result<Value>, map: (value: Value) => unknown = value => value): Result<Reply> {
  return result.ok ? success({ data: map(result.value) }) : result;
}
export function paged<Value>(result: Result<Page<Value>>, map: (value: Value) => unknown = value => value): Result<Reply> {
  return result.ok ? success({ data: result.value.items.map(map), pagination: { page: result.value.page, pageSize: result.value.pageSize,
    totalItems: result.value.totalItems, totalPages: result.value.totalPages } }) : result;
}
export function acknowledged(result: Result<unknown>): Result<Reply> { return reply(result, () => ({ accepted: true })); }
export function missingSession(): Result<Reply> { return failure('unauthorized', 'Management session required'); }

export function fleetActor(context: Context): FleetActor { return context.controller ?? actor(context); }
