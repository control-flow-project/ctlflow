import type Database from 'better-sqlite3';
import { executeSelect, executeInsert, executeUpdate } from '@tinqerjs/better-sqlite3-adapter';
import { failure, success } from '@crossfire/kernel/result';
import type { PublicationRepository } from '@crossfire/domain/publication/port';
import { schema } from '../../schema/tables.js';
import { stored } from '../stored.js';
import { page } from '../directory/index.js';
import { mapPublication, mapPublicationFile } from './map.js';
export function createPublicationRepository(database: Database.Database): PublicationRepository {
  return {
    find(id) { return stored(() => {
      const record = executeSelect(database, schema, (query, params) => query.from('agent')
        .join(query.from('publication'), agent => agent.principal_id, publication => publication.agent_id, (agent, publication) => ({ agent, publication }))
        .join(query.from('agent_name'), record => record.agent.principal_id, name => name.agent_id, (record, name) => ({ ...record, name }))
        .join(query.from('member'), record => record.agent.owner_id, owner => owner.principal_id, (record, owner) => ({ ...record, owner }))
        .where(record => record.publication.id === params.id).select(row => ({
          id: row.publication.id, agent_id: row.publication.agent_id, public_key: row.publication.public_key, title: row.publication.title,
          state: row.publication.state, revision: row.publication.revision, created_at: row.publication.created_at, expires_at: row.publication.expires_at,
          published_at: row.publication.published_at, deleted_at: row.publication.deleted_at, cleaned_at: row.publication.cleaned_at,
          total_bytes: row.publication.total_bytes, file_count: row.publication.file_count,
          agentName: row.agent.display_name_override ?? row.name.name, ownerId: row.agent.owner_id, ownerName: row.owner.display_name,
        })).firstOrDefault(), { id });
      return success(record ? { publication: mapPublication(record), agentName: record.agentName, ownerId: record.ownerId, ownerName: record.ownerName } : null);
    }); },
    files(id) { return stored(() => success(executeSelect(database, schema, (query, params) => query.from('publication_file')
      .where(row => row.publication_id === params.id).orderBy(row => row.path), { id }).map(mapPublicationFile))); },
    insert(publication, files) { return stored(() => {
      executeInsert(database, schema, (query, params) => query.insertInto('publication').values({ id: params.id, agent_id: params.agentId,
        public_key: params.publicKey, title: params.title, state: params.state, revision: params.revision, created_at: params.createdAt,
        expires_at: params.expiresAt, published_at: params.publishedAt, deleted_at: params.deletedAt, cleaned_at: params.cleanedAt,
        total_bytes: params.totalBytes, file_count: params.fileCount }), publication);
      for (const file of files) executeInsert(database, schema, (query, params) => query.insertInto('publication_file').values({ id: params.id,
        publication_id: params.publicationId, path: params.path, media_type: params.mediaType, bytes: params.bytes, sha256: params.sha256, uploaded: 0 }), file);
      return success(undefined);
    }); },
    uploaded(publicationId, fileId) { return stored(() => {
      const count = executeUpdate(database, schema, (query, params) => query.update('publication_file').set({ uploaded: 1 })
        .where(row => row.id === params.fileId && row.publication_id === params.publicationId), { publicationId, fileId });
      return count === 1 ? success(undefined) : failure('missing', 'Report file not found');
    }); },
    publish(id, expectedRevision, now) { return stored(() => {
      const count = executeUpdate(database, schema, (query, params) => query.update('publication').set({ state: 'published',
        revision: params.revision, published_at: params.now }).where(row => row.id === params.id && row.revision === params.expectedRevision
          && row.state === 'staging' && row.expires_at > params.now), { id, expectedRevision, revision: expectedRevision + 1, now });
      return count === 1 ? success(undefined) : failure('conflict', 'Report staging changed');
    }); },
    fence(id, expectedRevision, now) { return stored(() => {
      const count = executeUpdate(database, schema, (query, params) => query.update('publication').set({ state: 'deleted',
        revision: params.revision, deleted_at: params.now }).where(row => row.id === params.id && row.revision === params.expectedRevision
          && row.state !== 'deleted'), { id, expectedRevision, revision: expectedRevision + 1, now });
      return count === 1 ? success(undefined) : failure('conflict', 'Report revision changed');
    }); },
    cleaned(id, now) { return stored(() => {
      const count = executeUpdate(database, schema, (query, params) => query.update('publication').set({ cleaned_at: params.now })
        .where(row => row.id === params.id && row.state === 'deleted'), { id, now });
      return count === 1 ? success(undefined) : failure('conflict', 'Only deleted report storage can be reclaimed');
    }); },
    usage(agentId) { return stored(() => success({
      instanceBytes: executeSelect(database, schema, query => query.from('publication').where(row => row.cleaned_at === null).sum(row => row.total_bytes)) ?? 0,
      agentBytes: executeSelect(database, schema, (query, params) => query.from('publication').where(row => row.cleaned_at === null && row.agent_id === params.agentId).sum(row => row.total_bytes), { agentId }) ?? 0,
      instanceCount: executeSelect(database, schema, query => query.from('publication').where(row => row.cleaned_at === null).count()),
      agentCount: executeSelect(database, schema, (query, params) => query.from('publication').where(row => row.cleaned_at === null && row.agent_id === params.agentId).count(), { agentId }),
    })); },
    page(input) { return stored(() => {
      const params = { ownerId: input.ownerId ?? '', agentId: input.agentId ?? '', state: input.state ?? '', search: input.search,
        offset: (input.page - 1) * input.pageSize, limit: input.pageSize };
      const total = executeSelect(database, schema, (query, params) => query.from('agent')
        .join(query.from('publication'), agent => agent.principal_id, publication => publication.agent_id, (agent, publication) => ({ agent, publication }))
        .where(row => (params.ownerId === '' || row.agent.owner_id === params.ownerId) && (params.agentId === '' || row.agent.principal_id === params.agentId)
          && (params.state === '' || row.publication.state === params.state) && row.publication.title.includes(params.search)).count(), params);
      const records = executeSelect(database, schema, (query, params) => query.from('agent')
        .join(query.from('publication'), agent => agent.principal_id, publication => publication.agent_id, (agent, publication) => ({ agent, publication }))
        .join(query.from('agent_name'), row => row.agent.principal_id, name => name.agent_id, (row, name) => ({ ...row, name }))
        .join(query.from('member'), row => row.agent.owner_id, owner => owner.principal_id, (row, owner) => ({ ...row, owner }))
        .where(row => (params.ownerId === '' || row.agent.owner_id === params.ownerId) && (params.agentId === '' || row.agent.principal_id === params.agentId)
          && (params.state === '' || row.publication.state === params.state) && row.publication.title.includes(params.search))
        .orderByDescending(row => row.publication.created_at).thenByDescending(row => row.publication.id).skip(params.offset).take(params.limit)
        .select(row => ({ id: row.publication.id, agent_id: row.publication.agent_id, public_key: row.publication.public_key, title: row.publication.title,
          state: row.publication.state, revision: row.publication.revision, created_at: row.publication.created_at, expires_at: row.publication.expires_at,
          published_at: row.publication.published_at, deleted_at: row.publication.deleted_at, cleaned_at: row.publication.cleaned_at,
          total_bytes: row.publication.total_bytes, file_count: row.publication.file_count,
          agentName: row.agent.display_name_override ?? row.name.name, ownerId: row.agent.owner_id, ownerName: row.owner.display_name })), params);
      return success(page(records.map(record => ({ publication: mapPublication(record), agentName: record.agentName,
        ownerId: record.ownerId, ownerName: record.ownerName })), total, input));
    }); },
    maintenance(now, limit) { return stored(() => success(executeSelect(database, schema, (query, params) => query.from('publication')
      .where(row => row.cleaned_at === null && (row.state === 'deleted' || row.state === 'staging' && row.expires_at <= params.now))
      .orderBy(row => row.expires_at).thenBy(row => row.id).take(params.limit), { now, limit }).map(mapPublication))); },
    publicFile(publicKey, path) { return stored(() => {
      const row = executeSelect(database, schema, (query, params) => query.from('publication')
        .join(query.from('publication_file'), publication => publication.id, file => file.publication_id, (publication, file) => ({ publication, file }))
        .where(row => row.publication.public_key === params.publicKey && row.publication.state === 'published' && row.file.path === params.path && row.file.uploaded === 1)
        .select(row => ({ id: row.publication.id, agent_id: row.publication.agent_id, public_key: row.publication.public_key, title: row.publication.title,
          state: row.publication.state, revision: row.publication.revision, created_at: row.publication.created_at, expires_at: row.publication.expires_at,
          published_at: row.publication.published_at, deleted_at: row.publication.deleted_at, cleaned_at: row.publication.cleaned_at,
          total_bytes: row.publication.total_bytes, file_count: row.publication.file_count,
          fileId: row.file.id, path: row.file.path, mediaType: row.file.media_type, bytes: row.file.bytes, sha256: row.file.sha256, uploaded: row.file.uploaded,
        })).firstOrDefault(), { publicKey, path });
      return success(row ? { publication: mapPublication(row), file: mapPublicationFile({ id: row.fileId, publication_id: row.id,
        path: row.path, media_type: row.mediaType, bytes: row.bytes, sha256: row.sha256, uploaded: row.uploaded }) } : null);
    }); },
  };
}
