import { executeSelect } from '@tinqerjs/better-sqlite3-adapter';
import type Database from 'better-sqlite3';
import type { DiscoveryRepository, PrincipalSummary } from '@ctlflow/crossfire-domain/port/discovery';
import { schema } from '../../schema/tables.js';
import { success } from '@ctlflow/crossfire-kernel/result';
import { stored } from '../stored.js';
import { page } from '../directory/index.js';
import { mapRole } from '../role/map.js';
import { mapPermission } from '../permission/map.js';
import { agentDisplayName } from '@ctlflow/crossfire-domain/identity/display-name';
function namedAgent(row: Omit<PrincipalSummary, 'displayName'> & { name: string; ownerName: string }): PrincipalSummary {
  const { name, ownerName, ...principal } = row;
  return { ...principal, displayName: agentDisplayName(name, ownerName) };
}
export function createDiscoveryRepository(database: Database.Database): DiscoveryRepository {
  return {
    identities(backendUserIds) {
      return stored(() => {
        const humans = executeSelect(database, schema, (query, params) => query.from('principal')
          .join(query.from('member'), principal => principal.id, member => member.principal_id, (principal, member) => ({ ...principal, member }))
          .where(principal => principal.kind === 'human' && params.backendUserIds.includes(principal.backend_user_id))
          .select(principal => ({ backendUserId: principal.backend_user_id, kind: principal.kind, ownerBackendUserId: null, displayName: principal.member.display_name, ownerDisplayName: null })), { backendUserIds });
        const agents = executeSelect(database, schema, (query, params) => query.from('agent')
          .join(query.from('principal'), agent => agent.principal_id, principal => principal.id, (agent, principal) => ({ agent, principal }))
          .join(query.from('principal'), row => row.agent.owner_id, owner => owner.id, (row, owner) => ({ ...row, owner }))
          .join(query.from('member'), row => row.agent.owner_id, member => member.principal_id, (row, member) => ({ ...row, member }))
          .join(query.from('agent_name'), row => row.agent.principal_id, name => name.agent_id, (row, name) => ({ ...row, name }))
          .where(row => params.backendUserIds.includes(row.principal.backend_user_id))
          .select(row => ({ backendUserId: row.principal.backend_user_id, kind: row.principal.kind, ownerBackendUserId: row.owner.backend_user_id,
            name: row.name.name, ownerDisplayName: row.member.display_name })), { backendUserIds });
        const named = agents.map(({ name, ...identity }) => ({ ...identity, displayName: agentDisplayName(name, identity.ownerDisplayName) }));
        return success([...humans, ...named]);
      });
    },
    selected(principalIds) {
      return stored(() => {
        const humans = executeSelect(database, schema, (query, params) => query.from('member')
          .join(query.from('principal'), member => member.principal_id, principal => principal.id, (member, principal) => ({ member, principal }))
          .where(row => params.principalIds.includes(row.principal.id)).orderBy(row => row.principal.id)
          .select(row => ({ principalId: row.principal.id, backendUserId: row.principal.backend_user_id, kind: row.principal.kind,
            displayName: row.member.display_name, ownerId: row.principal.id, ownerBackendUserId: row.principal.backend_user_id })), { principalIds });
        const agents = executeSelect(database, schema, (query, params) => query.from('agent')
          .join(query.from('principal'), agent => agent.principal_id, principal => principal.id, (agent, principal) => ({ agent, principal }))
          .join(query.from('agent_name'), row => row.agent.principal_id, name => name.agent_id, (row, name) => ({ ...row, name }))
          .join(query.from('principal'), row => row.agent.owner_id, owner => owner.id, (row, owner) => ({ ...row, owner }))
          .join(query.from('member'), row => row.agent.owner_id, member => member.principal_id, (row, member) => ({ ...row, member }))
          .where(row => params.principalIds.includes(row.principal.id)).orderBy(row => row.principal.id)
          .select(row => ({ principalId: row.principal.id, backendUserId: row.principal.backend_user_id, kind: row.principal.kind,
            name: row.name.name, ownerName: row.member.display_name, ownerId: row.agent.owner_id, ownerBackendUserId: row.owner.backend_user_id })), { principalIds }).map(namedAgent);
        return success([...humans, ...agents].sort((left, right) => left.principalId.localeCompare(right.principalId)));
      });
    },
    principals(input) {
      return stored(() => {
        const parameters = { search: input.search, excludeId: input.excludeId ?? '' };
        const humanCount = input.kind === 'agent' ? 0 : executeSelect(database, schema, (query, params) => query.from('member').join(query.from('principal'), member => member.principal_id, principal => principal.id, (member, principal) => ({ member, principal }))
        .where(row => row.principal.status === 'active' && row.principal.id !== params.excludeId
          && (row.principal.backend_user_id.includes(params.search) || row.member.display_name.includes(params.search))).count(), parameters);
        const agentCount = input.kind === 'human' ? 0 : executeSelect(database, schema, (query, params) => query.from('agent').join(query.from('principal'), agent => agent.principal_id, principal => principal.id, (agent, principal) => ({ agent, principal }))
        .join(query.from('fleet_instance'), row => row.agent.principal_id, instance => instance.agent_id, (row, instance) => ({ ...row, instance }))
        .join(query.from('fleet'), row => row.agent.owner_id, fleet => fleet.owner_id, (row, fleet) => ({ ...row, fleet }))
        .join(query.from('agent_name'), row => row.agent.principal_id, name => name.agent_id, (row, name) => ({ ...row, name }))
        .join(query.from('principal'), row => row.agent.owner_id, owner => owner.id, (row, owner) => ({ ...row, owner }))
        .join(query.from('member'), row => row.agent.owner_id, member => member.principal_id, (row, member) => ({ ...row, member }))
        .where(row => row.instance.retired_at === null && row.fleet.archived_at === null && row.instance.fleet_key === row.fleet.fleet_key && row.principal.status === 'active' && row.owner.status === 'active' && row.principal.id !== params.excludeId
          && (row.principal.backend_user_id.includes(params.search) || row.name.name.includes(params.search))).count(), parameters);
        const offset = (input.page - 1) * input.pageSize;
        const humanLimit = Math.min(input.pageSize, Math.max(0, humanCount - offset));
        const rows: PrincipalSummary[] = humanLimit === 0 ? [] : executeSelect(database, schema, (query, params) => query.from('member').join(query.from('principal'), member => member.principal_id, principal => principal.id, (member, principal) => ({ member, principal }))
        .where(row => row.principal.status === 'active' && row.principal.id !== params.excludeId
          && (row.principal.backend_user_id.includes(params.search) || row.member.display_name.includes(params.search)))
          .orderBy(row => row.member.display_name).thenBy(row => row.principal.id).skip(params.offset).take(params.limit)
          .select(row => ({ principalId: row.principal.id, backendUserId: row.principal.backend_user_id, kind: row.principal.kind,
            displayName: row.member.display_name, ownerId: row.principal.id, ownerBackendUserId: row.principal.backend_user_id })),
          { ...parameters, offset, limit: humanLimit });
        if (input.kind !== 'human' && rows.length < input.pageSize) rows.push(...executeSelect(database, schema, (query, params) => query.from('agent').join(query.from('principal'), agent => agent.principal_id, principal => principal.id, (agent, principal) => ({ agent, principal }))
        .join(query.from('fleet_instance'), row => row.agent.principal_id, instance => instance.agent_id, (row, instance) => ({ ...row, instance }))
        .join(query.from('fleet'), row => row.agent.owner_id, fleet => fleet.owner_id, (row, fleet) => ({ ...row, fleet }))
        .join(query.from('agent_name'), row => row.agent.principal_id, name => name.agent_id, (row, name) => ({ ...row, name }))
        .join(query.from('principal'), row => row.agent.owner_id, owner => owner.id, (row, owner) => ({ ...row, owner }))
        .join(query.from('member'), row => row.agent.owner_id, member => member.principal_id, (row, member) => ({ ...row, member }))
        .where(row => row.instance.retired_at === null && row.fleet.archived_at === null && row.instance.fleet_key === row.fleet.fleet_key && row.principal.status === 'active' && row.owner.status === 'active' && row.principal.id !== params.excludeId
          && (row.principal.backend_user_id.includes(params.search) || row.name.name.includes(params.search)))
          .orderBy(row => row.name.name).thenBy(row => row.principal.id).skip(params.offset).take(params.limit)
          .select(row => ({ principalId: row.principal.id, backendUserId: row.principal.backend_user_id, kind: row.principal.kind,
            name: row.name.name, ownerName: row.member.display_name, ownerId: row.agent.owner_id, ownerBackendUserId: row.owner.backend_user_id })),
          { ...parameters, offset: Math.max(0, offset - humanCount), limit: input.pageSize - rows.length }).map(namedAgent));
        return success(page(rows, humanCount + agentCount, input));
      });
    },
    roles(kind) {
      return stored(() => success(executeSelect(database, schema, (query, params) => query.from('role')
        .where(row => row.principal_kind === params.kind).orderBy(row => row.code), { kind }).map(mapRole)));
    },
    permissions() {
      return stored(() => success(executeSelect(database, schema, query => query.from('permission').orderBy(row => row.code)).map(mapPermission)));
    },
  };
}
