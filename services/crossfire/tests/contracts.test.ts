import assert from "node:assert/strict";
import test from "node:test";
import { AGENT_INSTRUCTIONS_MAX_BYTES, DEFAULT_AGENT_INSTRUCTIONS } from "@crossfire/contracts/policy";
import { roomId } from "@crossfire/contracts/validation";
import { deliveryGrant, policy, deliveryPolicy, roomAuthority, grantApplication } from "@crossfire/contracts/schema/response";
import { agents as agentFilters } from "@crossfire/contracts/schema/query";
import { page } from "@crossfire/contracts/schema/query";
import { memberChange } from '@crossfire/contracts/schema/request';
import { owner } from '@crossfire/contracts/schema/response';


test("native room identities remain opaque, including version 12 IDs", () => {
  const room = "!Z1lqALvgesu1ZL4m19nCNHXvw5TCMT8Os8gljGrpmug";
  assert.equal(roomId(room), true);
  assert.equal(roomId("!native:example.org"), true);
  for (const invalid of ["", "!", "room", "!room id", "!room\n"]) assert.equal(roomId(invalid), false);
  assert.equal(deliveryGrant({ roomId: room, accessMode: "read", powerLevel: null, muted: false }).ok, true);
});

test('room authority and observations distinguish immutable creators from finite power levels', () => {
  const authority = { matrixUserId: '@alice:test.localhost', powerLevel: null, creator: true, creatorIds: ['@alice:test.localhost'],
    readLevel: -1, replyLevel: 0, inviteLevel: 0, kickLevel: 50, changePowerLevel: 50, nativePermissions: [] };
  assert(roomAuthority(authority).ok);
  assert(roomAuthority({ ...authority, creator: false, powerLevel: 0 }).ok);
  assert.equal(roomAuthority({ ...authority, powerLevel: 100 }).ok, false);
  assert.equal(roomAuthority({ ...authority, creator: false }).ok, false);
  const observation = { observedGeneration: null, appliedRevision: null, appliedAccessRevision: null, membership: 'join',
    creator: true, powerLevel: null, lastAttemptAt: null, lastSuccessAt: null, errorCode: null, errorMessage: null };
  assert(grantApplication(observation).ok);
  assert(grantApplication({ ...observation, creator: false, membership: null }).ok);
  assert(grantApplication({ ...observation, creator: false, powerLevel: 0 }).ok);
  assert.equal(grantApplication({ ...observation, powerLevel: 100 }).ok, false);
});

test('member labels retain every accepted signup username across requests and owner views', () => {
  const identity = { memberId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', matrixUserId: '@member:test.localhost', status: 'active' };
  const displayName = 'x'.repeat(100);
  assert(memberChange({ expectedRevision: 0, displayName }).ok);
  assert(owner({ ...identity, displayName }).ok);
  for (const invalid of ['', displayName + 'x', 'invalid\u0000label']) {
    assert.equal(memberChange({ expectedRevision: 0, displayName: invalid }).ok, false);
    assert.equal(owner({ ...identity, displayName: invalid }).ok, false);
  }
});

test('listener policy is explicit and rejects missing authority, self triggers and competing fields', () => {
  const policy = { agentId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', ownerMatrixId: '@owner:test.localhost', matrixUserId: '@agent:test.localhost',
    status: 'active', ownerStatus: 'active', ownerConversation: null, fleetIdleTimeoutSeconds: 1800, maxMessageBytes: 65536, roomGrants: [], wakeMode: 'owner', senderMatrixIds: ['@owner:test.localhost'] };
  assert(deliveryPolicy(policy).ok);
  assert(deliveryPolicy({ ...policy, wakeMode: 'nobody', senderMatrixIds: [] }).ok);
  assert.equal(deliveryPolicy({ ...policy, wakeMode: 'nobody' }).ok, false);
  for (const invalid of [{ ...policy, wakeMode: 'all' }, { ...policy, senderMatrixIds: [] }, { ...policy, senderMatrixIds: ['@owner:test.localhost', '@agent:test.localhost'] },
    { ...policy, senderMatrixIds: ['@owner:test.localhost', '@owner:test.localhost'] }, { ...policy, senderMatrixIds: ['Alice'] }, { ...policy, wake: true }]) {
    assert.equal(deliveryPolicy(invalid).ok, false);
  }
  const { wakeMode, ...missing } = policy;
  assert.equal(wakeMode, 'owner'); assert.equal(deliveryPolicy(missing).ok, false);
});

test("pagination rejects duplicate parameters and unbounded pages", () => {
  assert.deepEqual(page(new URLSearchParams('page=2&pageSize=1')), { ok: true, value: { page: 2, pageSize: 1 } });
  for (const query of ['page=0', 'pageSize=101', 'pageSize=1&pageSize=2', 'after=old']) assert.equal(page(new URLSearchParams(query)).ok, false);
});

test('administrator instructions are required plain text with an exact UTF-8 bound', () => {
  const input = { revision: 0, fleetIdleTimeoutSeconds: 1800, maxMessageBytes: 65536, maxOwnerAgents: 10, maxAgents: 100, maxPending: 100,
    enrollmentSeconds: 300, reconcileSeconds: 300, agentInstructions: DEFAULT_AGENT_INSTRUCTIONS, signupMode: 'invitation', invitationIssuers: 'administrators' };
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
  assert.deepEqual(parse(''), { ok: true, value: { page: 1, pageSize: 20, search: '', statuses: ['active', 'suspended'], listener: 'all' } });
  assert.deepEqual(parse('status=revoked,active&listener=offline'), { ok: true, value: { page: 1, pageSize: 20, search: '', statuses: ['revoked', 'active'], listener: 'offline' } });
  assert.deepEqual(parse('status='), { ok: true, value: { page: 1, pageSize: 20, search: '', statuses: [], listener: 'all' } });
  assert(parse('status=active&listener=online&pageSize=1&page=2').ok);
  for (const query of ['status=all', 'status=active,active', 'status=active&status=revoked', 'listener=busy',
    'listener=online&listener=offline', 'listener=', 'owner=@other:server', 'status=active,', 'unknown=true']) {
    assert.equal(parse(query).ok, false, query);
  }
});
