import { createServer, type IncomingMessage } from 'node:http';
import { once } from 'node:events';
import { realpathSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { object } from '@crossfire/contracts/validation';
import { writeJson, readJson } from '@crossfire/adapter-filesystem/index';
import { piRequest, piDescriptor } from './protocol.js';
import type { PiApi, PiContext } from './native.js';
import { visibleOutput } from '@crossfire/adapter-runtime/visible-output';

async function body(request: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk as Uint8Array);
    size += bytes.length;
    if (size > 8 * 1024 * 1024) throw new Error('Pi native request exceeds its byte bound');
    chunks.push(bytes);
  }
  return JSON.parse(Buffer.concat(chunks).toString()) as unknown;
}

export async function piHost(api: PiApi, context: PiContext, software: string) {
  if (!context.isProjectTrusted()) throw new Error('Trust the project in Pi before loading its Crossfire integration');
  const session = context.sessionManager.getSessionId();
  const workspace = realpathSync(context.cwd);
  const generation = randomUUID(), token = randomBytes(32).toString('base64url');
  const file = join(workspace, '.crossfire/runtime/pi', session + '.json');
  let active: { id: string } | undefined;
  let closed = false;
  let publication: { messageId: string; text: string; submitted: boolean; leaf: string | null } | undefined;
  let cancelled: { messageId: string; text: string } | undefined;
  function drain(): void {
    if (!closed && publication && !publication.submitted && context.isIdle()) {
      publication.submitted = true;
      api.sendMessage({ customType: 'crossfire', content: publication.text, display: true, details: { messageId: publication.messageId } }, { triggerTurn: true, deliverAs: 'followUp' });
    }
  }
  function verify(): void {
    if (closed || context.sessionManager.getSessionId() !== session || realpathSync(context.cwd) !== workspace) throw new Error('Pi session attachment closed or switched');
  }
  function received(messageId: string, text: string, leaf: string | null): boolean {
    const branch = context.sessionManager.getBranch();
    if (branch.length > 100_000) throw new Error('Pi native branch exceeds its verification bound');
    const boundary = leaf === null ? -1 : branch.findIndex(entry => object(entry).ok && (entry as Record<string, unknown>).id === leaf);
    if (leaf !== null && boundary < 0) throw new Error('Pi native branch lost its publication boundary');
    return branch.slice(boundary + 1).some(entry => {
      const parsed = object(entry);
      if (!parsed.ok || parsed.value.type !== 'custom_message' || parsed.value.customType !== 'crossfire') return false;
      const details = object(parsed.value.details);
      if (!details.ok || details.value.messageId !== messageId) return false;
      if (parsed.value.content !== text) throw new Error('Pi native input receipt differs from the submitted publication');
      return true;
    });
  }
  const server = createServer(async (request, response) => {
    try {
      const credential = Buffer.from(request.headers.authorization ?? '');
      const expected = Buffer.from('Bearer ' + token);
      if (request.method !== 'POST' || request.url !== '/' || request.headers.origin !== undefined
        || credential.length !== expected.length || !timingSafeEqual(credential, expected)) { response.writeHead(403).end('{}'); return; }
      const input = piRequest(await body(request));
      if (!input.ok) { response.writeHead(400).end('{}'); return; }
      const value = input.value;
      verify();
      if (value.session !== session || value.generation !== generation) { response.writeHead(409).end('{}'); return; }
      let result: unknown = null;
      switch (value.method) {
        case 'observe': {
          const branch = context.sessionManager.getBranch();
          if (branch.length > 100000) throw new Error('Pi native branch exceeds its verification bound');
          const position = value.after === null ? -1 : branch.findIndex(entry => object(entry).ok && (entry as Record<string, unknown>).id === value.after);
          if (value.after !== null && position < 0) throw new Error('Pi native observation boundary is no longer in this history');
          const window = branch.slice(position + 1, position + 257);
          result = { cursor: window.length ? (window.at(-1) as { id: string }).id : value.after, busy: !context.isIdle(), output: window.flatMap(entry => visibleOutput(entry, 'pi')) };
          break;
        }
        case 'verify': result = true; break;
        case 'boundary': result = { leaf: context.sessionManager.getLeafId() }; break;
        case 'publish':
          if (!value.messageId || value.text === undefined || !value.boundary) throw new Error('Incomplete Pi publication');
          if (!received(value.messageId, value.text, value.boundary.leaf)) {
            if (publication && publication.messageId === value.messageId) throw new Error('Pi publication is already pending');
            if (publication && !received(publication.messageId, publication.text, publication.leaf)) throw new Error('Pi publication must be sequential until its native receipt');
            cancelled = undefined;
            publication = { messageId: value.messageId, text: value.text, submitted: false, leaf: value.boundary.leaf };
            drain();
          }
          result = null; break;
        case 'received':
          if (!value.messageId || value.text === undefined || !value.boundary) throw new Error('Incomplete Pi receipt query');
          result = received(value.messageId, value.text, value.boundary.leaf) ? true
            : cancelled?.messageId === value.messageId && cancelled.text === value.text ? 'cancelled'
            : publication?.messageId === value.messageId && publication.text === value.text
              && publication.leaf === value.boundary.leaf && !publication.submitted ? 'waiting' : false; break;
        case 'cancel':
          if (!value.messageId || value.text === undefined) throw new Error('Incomplete Pi cancellation');
          if (publication?.messageId === value.messageId && publication.text === value.text && !publication.submitted) {
            cancelled = { messageId: value.messageId, text: value.text }; publication = undefined; result = true;
          } else result = false;
          break;
        case 'active':
          if (!context.isIdle() && !active) throw new Error('Pi native operation identity is not available');
          result = context.isIdle() ? null : active!.id; break;
        case 'interrupt':
          if (!value.turn) throw new Error('Missing Pi turn identity');
          if (!context.isIdle() && active?.id === value.turn) {
            if (value.recovery) throw new Error('Pi cancellation is uncertain and the captured operation is still active');
            context.abort();
          }
          result = null; break;
      }
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(result));
    } catch { if (!response.headersSent) response.writeHead(409); response.end('{}'); }
  });
  server.requestTimeout = 5000; server.headersTimeout = 5000; server.maxConnections = 8;
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') { server.close(); throw new Error('Cannot bind Pi native session connection'); }
  const descriptor = { version: 'pi-0.99' as const, session, generation, software, workspace, endpoint: 'http://127.0.0.1:' + address.port, token };
  try { writeJson(file, descriptor); } catch (error) { server.close(); throw error; }
  process.env.CROSSFIRE_PI_CONNECTION = file;
  return {
    file, descriptor,
    start() { verify(); active = { id: randomUUID() }; },
    end() { active = undefined; setImmediate(drain); },
    settled: drain,
    async close() {
      if (closed) return;
      closed = true;
      if (process.env.CROSSFIRE_PI_CONNECTION === file) delete process.env.CROSSFIRE_PI_CONNECTION;
      if (existsSync(file)) {
        const saved = piDescriptor(readJson<unknown>(file));
        if (saved.ok && saved.value.generation === generation) unlinkSync(file);
      }
      server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    },
  };
}
