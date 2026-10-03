import { createServer, type IncomingMessage } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { Operation } from '@crossfire/contracts/rest/operation';
import { failure, success, type Result, type FailureCode } from '@crossfire/kernel/result';
import type { FleetController } from '@fleetd/domain/controller';
import { operations } from '@fleetd/contracts/api';

type Reply = { data: unknown; pagination?: { page: number; pageSize: number; totalItems: number; totalPages: number } };
type Endpoint = { method: string; status: number; match(path: string): Record<string, string> | null; invoke(params: unknown, query: URLSearchParams, input: unknown): Promise<Result<Reply>> };
function bind<Params, Query, Input, Output>(operation: Operation<Params, Query, Input, Output>, handler: (params: Params, query: Query, input: Input) => Result<Reply> | Promise<Result<Reply>>): Endpoint {
  const segments = operation.path.split('/');
  return { method: operation.method, status: operation.status,
    match(path) {
      const parts = path.split('/');
      if (parts.length !== segments.length) return null;
      const params: Record<string, string> = {};
      for (const [index, segment] of segments.entries()) {
        if (segment.startsWith('{')) { try { params[segment.slice(1, -1)] = decodeURIComponent(parts[index]!); } catch { return null; } }
        else if (segment !== parts[index]) return null;
      }
      return params;
    },
    async invoke(rawParams, rawQuery, rawInput) {
      const params = operation.params(rawParams), query = operation.query(rawQuery), input = operation.input(rawInput);
      if (!params.ok) return params; if (!query.ok) return query; if (!input.ok) return input;
      const result = await handler(params.value, query.value, input.value);
      if (!result.ok) return result;
      const output = operation.output(result.value.data);
      if (!output.ok || operation.collection !== (result.value.pagination !== undefined)) return failure('native', 'Daemon response contract failed');
      return success({ ...result.value, data: output.value });
    },
  };
}
function reply<Value>(result: Result<Value>): Result<Reply> { return result.ok ? success({ data: result.value }) : result; }
function acknowledged(result: Result<unknown>): Result<Reply> { return result.ok ? success({ data: { accepted: true } }) : result; }
function paged<Value>(result: Result<Value[]>, query: { page: number; pageSize: number }): Result<Reply> {
  return result.ok ? success({ data: result.value.slice((query.page - 1) * query.pageSize, query.page * query.pageSize), pagination: { ...query, totalItems: result.value.length, totalPages: Math.ceil(result.value.length / query.pageSize) } }) : result;
}
const statuses: Record<FailureCode, number> = { invalid: 400, unauthorized: 401, forbidden: 403, missing: 404, conflict: 409, stale_revision: 409,
  name_collision: 409, capacity: 409, limit: 413, body_too_large: 413, rate_limit: 429, method_not_allowed: 405, native: 502, unavailable: 503 };
async function body(request: IncomingMessage): Promise<Result<unknown>> {
  let length = 0; const buffers: Buffer[] = [];
  for await (const value of request) {
    const buffer = Buffer.from(value as Uint8Array); length += buffer.length;
    if (length > 1024 * 1024) return failure('body_too_large', 'Request exceeds 1 MiB');
    buffers.push(buffer);
  }
  if (!length) return success({});
  if (request.headers['content-type']?.split(';')[0] !== 'application/json') return failure('invalid', 'Use application/json');
  try { return success(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(buffers)))); }
  catch { return failure('invalid', 'Invalid JSON'); }
}
export function createDaemonHttp(controller: FleetController, stopped: () => void) {
  const routes = [
    bind(operations.status, () => reply(success(controller.status()))),
    bind(operations.fleets, (_params, query) => paged(controller.list(), query)),
    bind(operations.addFleet, (_params, _query, input) => reply(controller.add(input.directory))),
    bind(operations.fleet, params => reply(controller.view(params.fleetId))),
    bind(operations.changeFleet, (params, _query, input) => reply(controller.rename(params.fleetId, input.expectedRevision, input.label))),
    bind(operations.removeFleet, async (params, _query, input) => acknowledged(await controller.remove(params.fleetId, input.expectedRevision))),
    bind(operations.changeFleetDelivery, async (params, _query, input) => reply(await controller.delivery(params.fleetId, input))),
    bind(operations.createFleetMessage, async (params, _query, input) => reply(await controller.message(params.fleetId, input))),
    bind(operations.agents, (params, query) => { const fleet = controller.view(params.fleetId); return paged(fleet.ok ? success(fleet.value.instances) : fleet, query); }),
    bind(operations.agent, params => { const fleet = controller.view(params.fleetId); if (!fleet.ok) return fleet; const instance = fleet.value.instances.find(instance => instance.instance.key === params.instanceKey); return instance ? reply(success(instance)) : failure('missing', 'Instance not found'); }),
    bind(operations.contexts, async params => reply(await controller.contexts(params.fleetId, params.instanceKey))),
    bind(operations.attachment, async (params, query) => reply(await controller.attachment(params.fleetId, params.instanceKey, query.context))),
    bind(operations.addAgent, async (params, _query, input) => reply(await controller.editInstance(params.fleetId, input.expectedRevision, { kind: 'add', instance: input.instance }))),
    bind(operations.changeAgent, async (params, _query, input) => reply(await controller.editInstance(params.fleetId, input.expectedRevision, { kind: 'definition', instanceKey: params.instanceKey, definition: input.definition }))),
    bind(operations.removeAgent, async (params, _query, input) => reply(await controller.editInstance(params.fleetId, input.expectedRevision, { kind: 'remove', instanceKey: params.instanceKey }))),
    bind(operations.operate, async (_params, _query, input) => reply(await controller.operate(input))),
    bind(operations.operation, params => reply(controller.operation(params.operationId))),
  ];
  const server = createServer({ maxHeaderSize: 8192, requestTimeout: 15000, headersTimeout: 10000 }, (request, response) => {
    const requestId = randomUUID();
    void (async () => {
      let result: Result<Reply>, status = 200;
      if (request.headers.host !== 'localhost' || request.headers.origin || request.headers.authorization || request.headers.cookie) result = failure('forbidden', 'Use the private controller socket without browser or bearer credentials');
      else {
        const url = new URL(request.url ?? '/', 'http://localhost'), matches = routes.map(route => ({ route, params: route.match(url.pathname) })).filter(value => value.params);
        const selected = matches.find(value => value.route.method === request.method);
        if (!selected) result = failure(matches.length ? 'method_not_allowed' : 'missing', 'No such daemon operation');
        else {
          const input = await body(request);
          result = input.ok ? await selected.route.invoke(selected.params, url.searchParams, input.value) : input;
          status = selected.route.status;
        }
      }
      response.writeHead(result.ok ? status : statuses[result.error.code], { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      if (controller.status().stopping) response.once('finish', stopped);
      response.end(JSON.stringify(result.ok ? { data: result.value.data, meta: { requestId, ...result.value.pagination } } : { error: result.error, meta: { requestId } }));
    })().catch(() => { response.writeHead(500, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ error: { code: 'unavailable', message: 'Daemon operation failed' }, meta: { requestId } })); });
  });
  return server;
}
