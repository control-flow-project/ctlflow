import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { ServerResponse } from 'node:http';
import type { TestContext } from 'node:test';
import { contractHttp } from '@ctlflow/crossfire-test-support/contract-http';
import { list, observe, record, text } from '@ctlflow/crossfire-test-support/contract-process';
import type { ContractPlatform } from '@ctlflow/crossfire-test-support/contract-platform';

export type MessageFixture = { platform: ContractPlatform; fleetDirectory: string; agent: { id: string; matrixUserId: string; token: string };
  provider: { requests: readonly unknown[]; hold(): void; held(): ServerResponse | undefined; finish(): void }; idle(): Promise<boolean>; delivery(enabled: boolean): Promise<void> };
export function lastUser(request: unknown): string {
  const body = record(request), rows = list(body.input ?? body.messages).map(record), user = rows.findLast(value => value.role === 'user'); assert(user, 'Native provider must receive an attributed user input');
  return typeof user.content === 'string' ? user.content : list(user.content).map(value => text(record(value).text)).join('\n');
}
export async function messageContracts(scope: TestContext, fixture: MessageFixture): Promise<void> {
  const { platform, agent, provider } = fixture; const roomPath = (room: string) => '/_matrix/client/v3/rooms/' + encodeURIComponent(room);
  async function matrix(method: string, path: string, body?: unknown) { const response = await contractHttp(platform.origin, method, '/_matrix/client/v3' + path, body, { Authorization: 'Bearer ' + platform.owner.nativeToken }); assert.equal(response.status, 200, JSON.stringify(response.body).slice(0, 1024)); return record(response.body); }
  async function listener(input: unknown, status: number | readonly number[] = 200) {
    const file = join(fixture.fleetDirectory, 'agents/analyst/workarea/analyst/.crossfire/state/analyst/listener.json'); const binding = record(JSON.parse(readFileSync(file, 'utf8')) as unknown); assert.equal(statSync(file).mode & 0o777, 0o600);
    const response = await contractHttp('http://127.0.0.1:' + String(binding.port), 'POST', '/bindings/' + encodeURIComponent(text(binding.binding)) + '/control', input, { Authorization: 'Bearer ' + text(binding.secret) }); assert((typeof status === 'number' ? [status] : status).includes(response.status), 'Unexpected listener status ' + response.status + ': ' + JSON.stringify(response.body).slice(0, 1024)); return record(response.body);
  }
  async function query(room?: string) {
    const result = await listener({ action: 'read', input: { kind: 'history', ...(room ? { room } : {}), limit: 10, outputBytes: 4096, direction: 'b', cursors: { entries: [] } } }); assert.equal(result.ok, true); return record(result.value);
  }
  const created = await matrix('POST', '/createRoom', { name: 'Native message contracts', invite: [agent.matrixUserId] }); const room = text(created.room_id);
  await observe(async () => {
    const members = await matrix('GET', '/rooms/' + encodeURIComponent(room) + '/joined_members'); return Object.hasOwn(record(members.joined), agent.matrixUserId);
  }, 'Authorized native invitation must be accepted by the shared listener', 90000);
  await observe(async () => { const response = await contractHttp(platform.origin, 'GET', '/api/agents/' + agent.id + '/delivery-policy', undefined, { Authorization: 'Bearer ' + agent.token }); return response.status === 200 && JSON.stringify(response.body).includes(room); }, 'Accepted native room must have its scoped grant');
  const send = (body: string, mention = false) => matrix('PUT', '/rooms/' + encodeURIComponent(room) + '/send/m.room.message/' + randomUUID(), { msgtype: 'm.text', body, ...(mention ? { 'm.mentions': { user_ids: [agent.matrixUserId] } } : {}) });
  await scope.test('real messages carry source attribution and real mentions interrupt held native work', async child => {
    child.after(() => { if (provider.held()) provider.finish(); });
    provider.hold(); const first = 'Original task ' + randomUUID(); await send(first); await observe(() => provider.held() !== undefined, 'First native task reaches the held inert provider', 30000); const held = provider.held()!;
    assert.equal(provider.requests.length, 1); assert(lastUser(provider.requests[0]).includes(first)); assert(lastUser(provider.requests[0]).includes(room)); assert(lastUser(provider.requests[0]).includes(platform.owner.matrixUserId));
    provider.hold(); const replacement = 'Interrupt and use this instruction ' + randomUUID(); const started = Date.now(); const mentioned = await send(replacement, true); const event = text(mentioned.event_id);
    try { await observe(() => provider.requests.length === 2 && provider.held() !== undefined, 'Mention reaches a replacement native turn without waiting for the first response', 10000); }
    catch (error) {
      scope.diagnostic(JSON.stringify({ steeringFailure: { requests: provider.requests.length, held: provider.held() !== undefined, originalClosed: held.destroyed,
        inputs: provider.requests.slice(-4).map(request => lastUser(request).slice(0, 2048)) } }));
      throw error;
    }
    assert(Date.now() - started < 10000, 'No ordinary publication hold slot may delay steering'); assert(lastUser(provider.requests[1]).includes(replacement), 'Replacement native input: ' + lastUser(provider.requests[1]).slice(0, 4096)); assert(lastUser(provider.requests[1]).includes(room)); await observe(() => held.destroyed, 'Interruption closes the original held provider request');
    const conversation = await contractHttp(platform.origin, 'POST', '/api/agents/' + agent.id + '/owner-conversation', {}, { Authorization: 'Bearer ' + agent.token }); assert.equal(conversation.status, 200); const ownerRoom = text(record(record(conversation.body).data).roomId); assert.notEqual(ownerRoom, room);
    await observe(async () => {
      const response = await contractHttp(platform.origin, 'GET', roomPath(ownerRoom) + '/messages?dir=b&limit=100', undefined, { Authorization: 'Bearer ' + platform.owner.nativeToken }); if (response.status !== 200) return false; const notices = list(record(response.body).chunk).map(value => record(record(value).content).body).filter(value => typeof value === 'string');
      return notices.some(value => value.includes('Mention received') && value.includes(event) && value.includes(room)) && notices.some(value => value.includes('Native input accepted') && value.includes(event));
    }, 'Private owner DM records both receipt and actual native acceptance');
    provider.finish(); await observe(fixture.idle, 'Replacement native task completes'); assert.equal(provider.requests.length, 2);
  });
  await scope.test('large batches use private files, while room and global history remain tool-accessible', async child => {
    child.after(() => { if (provider.held()) provider.finish(); });
    await fixture.delivery(false); provider.hold(); const marker = 'Large message proof ' + randomUUID(); await send(marker + 'A'.repeat(40000)); await send(marker + 'B'.repeat(40000)); await fixture.delivery(true);
    await observe(() => provider.requests.length === 3 && provider.held() !== undefined, 'Large chat batch reaches native input'); const input = lastUser(provider.requests[2]); assert(Buffer.byteLength(input) <= 65536); const pointerLine = input.split('\n').find(value => value.startsWith('{') && value.includes('crossfire-message-files')); assert(pointerLine, 'Large native input must be a file pointer, not the full messages'); const pointer = record(JSON.parse(pointerLine) as unknown);
    const manifest = text(pointer.manifest); assert(manifest.startsWith(join(fixture.fleetDirectory, 'agents/analyst/workarea/analyst/.crossfire/state/analyst') + '/')); assert.equal(statSync(manifest).mode & 0o777, 0o600); const bundle = record(JSON.parse(readFileSync(manifest, 'utf8')) as unknown); const messages = list(bundle.messages).map(record);
    const contents = messages.map(value => readFileSync(text(value.file), 'utf8')); assert(contents.some(value => value.includes(marker + 'A'.repeat(40000)))); assert(contents.some(value => value.includes(marker + 'B'.repeat(40000))));
    provider.finish(); await observe(fixture.idle, 'Large batch completes');
    await observe(() => !existsSync(join(fixture.fleetDirectory, 'agents/analyst/workarea/analyst/.crossfire/state/analyst/cursors.json.chat-publication')), 'Native receipt and Matrix checkpoints settle before the next delivery pause');
    const before = provider.requests.length; const specific = await query(room); assert.equal(specific.queryId, null); assert(text(specific.text).includes(room) || text(specific.text).includes('crossfire-message-files')); const global = await query(); assert.equal(global.queryId, null); assert(text(global.text).length > 0); assert.equal(provider.requests.length, before, 'History browsing never invokes the model');
    const denied = await listener({ action: 'read', input: { kind: 'history', room: '!not-granted:architecture.localhost', limit: 10, outputBytes: 4096, direction: 'b', cursors: { entries: [] } } }, 409); assert.equal(denied.ok, false); assert.equal(record(denied.error).code, 'forbidden');
  });
  await scope.test('explicit unread reads and acknowledgment advance only observed records without model calls', async () => {
    await fixture.delivery(false); const before = provider.requests.length; const marker = 'Read only through the history tool ' + randomUUID();
    try {
      await send(marker);
      let answer: Record<string, unknown> = {}; let reported = false; await observe(async () => {
        const response = await listener({ action: 'read', input: { kind: 'unread', room, limit: 100, outputBytes: 4096, direction: 'f', cursors: { entries: [] } } }, [200, 409]);
        if (response.ok !== true) {
          assert.equal(record(response.error).code, 'conflict', 'Only an actual publication/query ownership conflict is retryable');
          if (!reported) {
            reported = true; const path = join(fixture.fleetDirectory, 'agents/analyst/workarea/analyst/.crossfire/state/analyst/cursors.json.chat-publication'); const plan = existsSync(path) ? record(JSON.parse(readFileSync(path, 'utf8')) as unknown) : null;
            scope.diagnostic(JSON.stringify({ unreadConflict: record(response.error).message, steps: plan === null ? null : list(plan.steps).map(value => record(value).status), pendingCheckpoint: existsSync(path.replace('.chat-publication', '.ack')) }));
          }
          return false;
        }
        answer = record(response.value); return true;
      }, 'Paused listener settles any prior publication and permits authorized unread queries');
      const id = text(answer.queryId); assert(text(answer.text).includes(marker)); const acknowledged = await listener({ action: 'acknowledge', queryId: id }); assert.equal(acknowledged.ok, true); assert.equal(record(acknowledged.value).accepted, true);
    } finally { await fixture.delivery(true); }
    await observe(fixture.idle, 'Delivery resumes without replaying acknowledged tool input'); assert.equal(provider.requests.length, before);
  });
}
