import { executeSelect } from '@tinqerjs/better-sqlite3-adapter';
import type Database from 'better-sqlite3';
import type { DiscoveryRepository, PrincipalSummary } from '@crossfire/domain/port/discovery';
import { schema } from '../../schema/tables.js';
import { success } from '@crossfire/kernel/result';
import { stored } from '../stored.js';
import { page } from '../directory/index.js';
import { mapRole } from '../role/map.js';
import { mapPermission } from '../permission/map.js';
export function createDiscoveryRepository(database: Database.Database): DiscoveryRepository {
  return {
    selected(principalIds) {
      return stored(() => {
        const humans = executeSelect(database, schema, (query, params) => query.from('member')
          .join(query.from('principal'), member => member.principal_id, principal => principal.id, (member, principal) => ({ member, principal }))
          .where(row => params.principalIds.includes(row.principal.id)).orderBy(row => row.principal.id)
          .select(row => ({ principalId: row.principal.id, matrixUserId: row.principal.matrix_user_id, kind: row.principal.kind,
            displayName: row.member.display_name, ownerId: row.principal.id, ownerMatrixId: row.principal.matrix_user_id })), { principalIds });
        const agents = executeSelect(database, schema, (query, params) => query.from('agent')
          .join(query.from('principal'), agent => agent.principal_id, principal => principal.id, (agent, principal) => ({ agent, principal }))
          .join(query.from('agent_name'), row => row.agent.principal_id, name => name.agent_id, (row, name) => ({ ...row, name }))
          .join(query.from('principal'), row => row.agent.owner_id, owner => owner.id, (row, owner) => ({ ...row, owner }))
          .where(row => params.principalIds.includes(row.principal.id)).orderBy(row => row.principal.id)
          .select(row => ({ principalId: row.principal.id, matrixUserId: row.principal.matrix_user_id, kind: row.principal.kind,
            displayName: row.agent.display_name_override ?? row.name.name, ownerId: row.agent.owner_id, ownerMatrixId: row.owner.matrix_user_id })), { principalIds });
        return success([...humans, ...agents].sort((left, right) => left.principalId.localeCompare(right.principalId)));
      });
    },
    principals(input) {
      return stored(() => {
        const parameters = { search: input.search.toLowerCase(), excludeId: input.excludeId ?? '' };
        const humanCount = input.kind === 'agent' ? 0 : executeSelect(database, schema, (query, params) => query.from('member').join(query.from('principal'), member => member.principal_id, principal => principal.id, (member, principal) => ({ member, principal }))
        .where(row => row.principal.status === 'active' && row.principal.id !== params.excludeId
          && (row.principal.matrix_user_id.toLowerCase().includes(params.search) || row.member.display_name.toLowerCase().includes(params.search))).count(), parameters);
        const agentCount = input.kind === 'human' ? 0 : executeSelect(database, schema, (query, params) => query.from('agent').join(query.from('principal'), agent => agent.principal_id, principal => principal.id, (agent, principal) => ({ agent, principal }))
        .join(query.from('agent_name'), row => row.agent.principal_id, name => name.agent_id, (row, name) => ({ ...row, name }))
        .join(query.from('principal'), row => row.agent.owner_id, owner => owner.id, (row, owner) => ({ ...row, owner }))
        .where(row => row.principal.status === 'active' && row.owner.status === 'active' && row.principal.id !== params.excludeId
          && (row.principal.matrix_user_id.toLowerCase().includes(params.search) || row.name.name.toLowerCase().includes(params.search)
            || (row.agent.display_name_override ?? '').toLowerCase().includes(params.search))).count(), parameters);
        const offset = (input.page - 1) * input.pageSize;
        const humanLimit = Math.min(input.pageSize, Math.max(0, humanCount - offset));
        const rows: PrincipalSummary[] = humanLimit === 0 ? [] : executeSelect(database, schema, (query, params) => query.from('member').join(query.from('principal'), member => member.principal_id, principal => principal.id, (member, principal) => ({ member, principal }))
        .where(row => row.principal.status === 'active' && row.principal.id !== params.excludeId
          && (row.principal.matrix_user_id.toLowerCase().includes(params.search) || row.member.display_name.toLowerCase().includes(params.search)))
          .orderBy(row => row.member.display_name).thenBy(row => row.principal.id).skip(params.offset).take(params.limit)
          .select(row => ({ principalId: row.principal.id, matrixUserId: row.principal.matrix_user_id, kind: row.principal.kind,
            displayName: row.member.display_name, ownerId: row.principal.id, ownerMatrixId: row.principal.matrix_user_id })),
          { ...parameters, offset, limit: humanLimit });
        if (input.kind !== 'human' && rows.length < input.pageSize) rows.push(...executeSelect(database, schema, (query, params) => query.from('agent').join(query.from('principal'), agent => agent.principal_id, principal => principal.id, (agent, principal) => ({ agent, principal }))
        .join(query.from('agent_name'), row => row.agent.principal_id, name => name.agent_id, (row, name) => ({ ...row, name }))
        .join(query.from('principal'), row => row.agent.owner_id, owner => owner.id, (row, owner) => ({ ...row, owner }))
        .where(row => row.principal.status === 'active' && row.owner.status === 'active' && row.principal.id !== params.excludeId
          && (row.principal.matrix_user_id.toLowerCase().includes(params.search) || row.name.name.toLowerCase().includes(params.search)
            || (row.agent.display_name_override ?? '').toLowerCase().includes(params.search)))
          .orderBy(row => row.name.name).thenBy(row => row.principal.id).skip(params.offset).take(params.limit)
          .select(row => ({ principalId: row.principal.id, matrixUserId: row.principal.matrix_user_id, kind: row.principal.kind,
            displayName: row.agent.display_name_override ?? row.name.name, ownerId: row.agent.owner_id, ownerMatrixId: row.owner.matrix_user_id })),
          { ...parameters, offset: Math.max(0, offset - humanCount), limit: input.pageSize - rows.length }));
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
