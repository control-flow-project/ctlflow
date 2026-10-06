import { createHash } from 'node:crypto';
import { API, segment } from '@ctlflow/crossfire-contracts/matrix';
import { roomId, userId } from '@ctlflow/crossfire-contracts/validation';
import { ownerConversationState } from '@ctlflow/crossfire-contracts/matrix-room';
import { failure, success, type Result } from '@ctlflow/crossfire-kernel/result';
import type { Authority } from '../account/authority.js';
import { nativeOk, nativeRequest, nativeState, type Native } from '../http.js';

async function directRooms(client: Native, identity: string): Promise<Result<Record<string, string[]>>> {
  const response = await nativeRequest(client, 'GET', API + '/user/' + segment(identity) + '/account_data/m.direct');
  if (!response.ok) return response;
  if (response.value.status === 404) return success({});
  if (response.value.status !== 200 || Object.keys(response.value.body).length > 2000) return failure('native', 'Native direct-message account data is unavailable');
  const rooms: Record<string, string[]> = {};
  for (const [target, identifiers] of Object.entries(response.value.body)) {
    if (!userId(target) || !Array.isArray(identifiers) || identifiers.length > 1000 || identifiers.some(identifier => !roomId(identifier))) {
      return failure('native', 'Invalid native direct-message account data');
    }
    rooms[target] = identifiers as string[];
  }
  return success(rooms);
}

async function privateConversation(client: Native, owner: string, agent: string, room: string): Promise<Result<void>> {
  const state = await nativeState(client, room);
  if (!state.ok) return state;
  return ownerConversationState(state.value, owner, agent);
}

export async function verifyOwnerConversation(accounts: Authority, owner: string, agent: string, room: string): Promise<Result<void>> {
  if (!userId(owner) || !userId(agent) || !roomId(room) || owner === agent) return failure('invalid', 'Invalid owner conversation identities');
  const client = await accounts.asUser(owner);
  return client.ok ? privateConversation(client.value, owner, agent, room) : client;
}

async function conversationName(client: Native, agent: string): Promise<Result<string>> {
  const profile = await nativeOk(client, 'GET', API + '/profile/' + segment(agent) + '/displayname');
  if (!profile.ok) return profile;
  const name = profile.value.displayname;
  return typeof name === 'string' && name.trim().length > 0 && name.length <= 255 ? success(name)
    : failure('native', 'Invalid native agent display name');
}

export async function markDirect(client: Native, identity: string, counterpart: string, room: string): Promise<Result<void>> {
  const current = await directRooms(client, identity);
  if (!current.ok) return current;
  if (current.value[counterpart]?.includes(room)) return success(undefined);
  const changed = await nativeOk(client, 'PUT', API + '/user/' + segment(identity) + '/account_data/m.direct',
    { ...current.value, [counterpart]: [room, ...(current.value[counterpart] ?? [])] });
  return changed.ok ? success(undefined) : changed;
}

export function createOwnerConversations(accounts: Authority, serverName: string) {
  const operations = new Map<string, Promise<void>>();
  async function ensure(owner: string, agent: string, selected: string | null): Promise<Result<string>> {
    if (!userId(owner) || !userId(agent) || owner === agent || !owner.endsWith(':' + serverName)
      || !agent.endsWith(':' + serverName) || selected !== null && !roomId(selected)) return failure('invalid', 'Invalid owner conversation identities');
    const ownerClient = await accounts.asUser(owner), agentClient = await accounts.asUser(agent);
    if (!ownerClient.ok) return ownerClient; if (!agentClient.ok) return agentClient;
    let room = selected;
    if (room === null) {
      const current = await directRooms(ownerClient.value, owner);
      if (!current.ok) return current;
      for (const candidate of current.value[agent] ?? []) {
        const verified = await privateConversation(ownerClient.value, owner, agent, candidate);
        if (verified.ok) { room = candidate; break; }
        if (verified.error.code !== 'forbidden') return verified;
      }
    }
    if (room === null) {
      const localAlias = 'crossfire-owner-' + createHash('sha256').update(JSON.stringify([owner, agent])).digest('hex');
      const aliasPath = API + '/directory/room/' + segment('#' + localAlias + ':' + serverName);
      let existing = await nativeRequest(ownerClient.value, 'GET', aliasPath);
      if (!existing.ok) return existing;
      if (existing.value.status === 404) {
        const name = await conversationName(ownerClient.value, agent);
        if (!name.ok) return name;
        const created = await nativeRequest(ownerClient.value, 'POST', API + '/createRoom', {
          preset: 'private_chat', visibility: 'private', is_direct: true, name: name.value, room_alias_name: localAlias, invite: [agent],
          power_level_content_override: { invite: 100 },
        });
        if (!created.ok) return created;
        if (created.value.status === 200 && roomId(created.value.body.room_id)) room = created.value.body.room_id;
        else if (created.value.status === 400 && created.value.body.errcode === 'M_ROOM_IN_USE') {
          existing = await nativeRequest(ownerClient.value, 'GET', aliasPath);
          if (!existing.ok) return existing;
        } else return failure('native', 'Native owner conversation creation was not confirmed');
      }
      if (room === null) {
        if (existing.value.status !== 200 || !roomId(existing.value.body.room_id)) return failure('native', 'Native owner conversation recovery was not confirmed');
        room = existing.value.body.room_id;
      }
    }
    const verified = await privateConversation(ownerClient.value, owner, agent, room);
    if (!verified.ok) return verified;
    const members = await nativeState(ownerClient.value, room);
    if (!members.ok) return members;
    const title = members.value.find(event => event.type === 'm.room.name' && event.state_key === '')?.content.name;
    if (title !== undefined && typeof title !== 'string') return failure('native', 'Invalid native conversation name');
    if (title === undefined || typeof title === 'string' && !title.trim()) {
      const name = await conversationName(ownerClient.value, agent);
      if (!name.ok) return name;
      const named = await nativeOk(ownerClient.value, 'PUT', API + '/rooms/' + segment(room) + '/state/m.room.name', { name: name.value });
      if (!named.ok) return named;
    }
    for (const [identity, client] of [[owner, ownerClient.value], [agent, agentClient.value]] as const) {
      const membership = members.value.find(event => event.type === 'm.room.member' && event.state_key === identity)?.content.membership;
      if (membership === 'ban') {
        const unbanned = await nativeOk(ownerClient.value, 'POST', API + '/rooms/' + segment(room) + '/unban', { user_id: identity });
        if (!unbanned.ok) return unbanned;
      }
      if (membership !== 'join') {
        if (identity === agent && membership !== 'invite') {
          const invited = await nativeOk(ownerClient.value, 'POST', API + '/rooms/' + segment(room) + '/invite', { user_id: agent });
          if (!invited.ok) return invited;
        }
        const joined = await nativeOk(client, 'POST', API + '/join/' + segment(room), {});
        if (!joined.ok) return joined;
      }
    }
    const final = await privateConversation(ownerClient.value, owner, agent, room);
    if (!final.ok) return final;
    const markedOwner = await markDirect(ownerClient.value, owner, agent, room);
    if (!markedOwner.ok) return markedOwner;
    const markedAgent = await markDirect(agentClient.value, agent, owner, room);
    return markedAgent.ok ? success(room) : markedAgent;
  }
  return async (owner: string, agent: string, room: string | null): Promise<Result<string>> => {
    const previous = operations.get(owner) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>(resolve => { release = resolve; });
    operations.set(owner, current);
    await previous;
    try { return await ensure(owner, agent, room); }
    finally { release(); if (operations.get(owner) === current) operations.delete(owner); }
  };
}
