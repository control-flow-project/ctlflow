import assert from "node:assert/strict";
import test from "node:test";
import { AGENT_INSTRUCTIONS_MAX_BYTES, DEFAULT_AGENT_INSTRUCTIONS, authorityChanged, grants, policy, roomId } from "../packages/contracts/src/management.js";
import { agentFilters } from "../packages/contracts/src/agent-filters.js";
import { page } from "../apps/server/src/http.js";
import { deliveryPolicy } from '../packages/contracts/src/delivery.js';

test("native room identities remain opaque, including version 12 IDs", () => {
  const room = "!Z1lqALvgesu1ZL4m19nCNHXvw5TCMT8Os8gljGrpmug";
  assert.equal(roomId(room), true);
  assert.equal(roomId("!native:example.org"), true);
  for (const invalid of ["", "!", "room", "!room id", "!room\n"]) assert.equal(roomId(invalid), false);
  assert.equal(grants([{ room, access: "read", muted: false }]).ok, true);
});

test('listener policy is explicit and rejects missing authority, self triggers and competing fields', () => {
  const policy = { id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', owner: '@owner:test.localhost', userId: '@agent:test.localhost',
    status: 'active', ownerStatus: 'active', grants: [], wakePolicy: 'owner', senders: ['@owner:test.localhost'] };
  assert(deliveryPolicy(policy).ok);
  for (const invalid of [{ ...policy, wakePolicy: 'all' }, { ...policy, senders: [] }, { ...policy, senders: ['@owner:test.localhost', '@agent:test.localhost'] },
    { ...policy, senders: ['@owner:test.localhost', '@owner:test.localhost'] }, { ...policy, senders: ['Alice'] }, { ...policy, wake: true }]) {
    assert.equal(deliveryPolicy(invalid).ok, false);
  }
  const { wakePolicy, ...missing } = policy;
  assert.equal(wakePolicy, 'owner'); assert.equal(deliveryPolicy(missing).ok, false);
});

test("cursor filtering and sorting use the same native ID order", () => {
  const rows = [{ id: "!a:example.org" }, { id: "!A:example.org" }];
  const first = page(rows, new URL("https://example.org/?limit=1"));
  assert(first.ok);
  assert.equal(first.value.items[0]!.id, "!A:example.org");
  const second = page(rows, new URL("https://example.org/?limit=1&after=" + encodeURIComponent(first.value.next!)));
  assert(second.ok);
  assert.deepEqual(second.value.items, [{ id: "!a:example.org" }]);
  assert.equal(second.value.next, null);
  assert.equal(page(rows, new URL("https://example.org/?limit=1&limit=2")).ok, false);
});

test("notification settings do not create new access authority", () => {
  assert.equal(authorityChanged([{ room: "!native", access: "read", muted: false }], [{ room: "!native", access: "read", muted: true }]), false);
  assert.equal(authorityChanged([{ room: "!native", access: "read", muted: false }], [{ room: "!native", access: "reply", muted: false }]), true);
});

test('administrator instructions are required plain text with an exact UTF-8 bound', () => {
  const input = { revision: 0, maxOwnerAgents: 10, maxAgents: 100, maxPending: 100,
    enrollmentSeconds: 300, reconcileSeconds: 300, agentInstructions: DEFAULT_AGENT_INSTRUCTIONS };
  assert(policy(input).ok);
  for (const instructions of ['Keep replies concise.\nUse project tickets.\t東京', '<script>alert("plain text")</script>',
    'a'.repeat(AGENT_INSTRUCTIONS_MAX_BYTES), 'é'.repeat(AGENT_INSTRUCTIONS_MAX_BYTES / 2)]) {
    const result = policy({ ...input, agentInstructions: instructions });
    assert(result.ok);
    assert.equal(result.value.agentInstructions, instructions);
  }
  for (const instructions of [null, 1, {}, 'a'.repeat(AGENT_INSTRUCTIONS_MAX_BYTES + 1),
    'é'.repeat(AGENT_INSTRUCTIONS_MAX_BYTES / 2) + 'a', 'bad\u0000text', '\u001b[31mred', '\u007f']) {
    assert.equal(policy({ ...input, agentInstructions: instructions }).ok, false);
  }
  const { agentInstructions: removed, ...missing } = input;
  assert.equal(removed, '');
  assert.equal(policy(missing).ok, false);
  assert.equal(policy({ ...input, instructionTemplate: '' }).ok, false);
});

test('agent filter contract separates account status and listener activity', () => {
  const parse = (query: string) => agentFilters(new URLSearchParams(query));
  assert.deepEqual(parse(''), { ok: true, value: { statuses: ['active', 'suspended'], listener: 'all' } });
  assert.deepEqual(parse('status=revoked,active&listener=offline'), { ok: true, value: { statuses: ['active', 'revoked'], listener: 'offline' } });
  assert.deepEqual(parse('status='), { ok: true, value: { statuses: [], listener: 'all' } });
  assert(parse('status=active&listener=online&limit=1&after=native-id').ok);
  for (const query of ['status=all', 'status=active,active', 'status=active&status=revoked', 'listener=busy',
    'listener=online&listener=offline', 'listener=', 'owner=@other:server', 'status=active,', 'unknown=true']) {
    assert.equal(parse(query).ok, false, query);
  }
});
