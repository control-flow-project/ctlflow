import { failure, success, type Result } from '@ctlflow/crossfire-kernel/result';
import { PUBLICATION_LIMITS } from '@ctlflow/crossfire-domain/publication/values';
import type { PublicationQuery } from '@ctlflow/crossfire-domain/publication/values';
import * as check from './schema/validation.js';
import { pagination, listQuery } from './schema/request.js';
export type { PublicationCreation, PublicationQuery, PublicationSummary, PublicationDetails } from '@ctlflow/crossfire-domain/publication/values';
export const publicationState = check.choice('staging', 'published', 'deleted');
const file = { path: check.text(240), mediaType: check.text(100), bytes: check.integer(0, PUBLICATION_LIMITS.fileBytes),
  sha256: check.refine(check.text(64, 64), value => /^[a-f0-9]{64}$/u.test(value), 'Expected SHA-256 hex') };
export const publicationCreation = check.object({ title: check.text(200), files: check.list(check.object(file), PUBLICATION_LIMITS.files, 1) });
const summary = { id: check.identifier, agentId: check.identifier, agentName: check.text(255), ownerId: check.identifier,
  ownerName: check.text(255), title: check.text(200), state: publicationState, revision: check.integer(), createdAt: check.integer(),
  expiresAt: check.integer(), publishedAt: check.nullable(check.integer()), deletedAt: check.nullable(check.integer()),
  totalBytes: check.integer(0, PUBLICATION_LIMITS.bundleBytes), fileCount: check.integer(1, PUBLICATION_LIMITS.files),
  url: check.nullable(check.text(2048)), allowedActions: check.list(check.choice('delete'), 1) };
export const publicationSummary = check.object(summary);
export const publicationDetails = check.object({ ...summary, files: check.list(check.object({ ...file, id: check.identifier, uploaded: check.boolean }), PUBLICATION_LIMITS.files, 1) });
export const publicationMutation = check.object({ expectedRevision: check.integer() });
export function publicationQuery(input: unknown): Result<PublicationQuery> {
  const query = listQuery(['page', 'pageSize', 'ownerId', 'agentId', 'search', 'state'])(input);
  if (!query.ok) return query;
  const page = pagination(query.value); if (!page.ok) return page;
  const search = check.text(200, 0)(query.value.get('search') ?? ''); if (!search.ok) return search;
  const ownerId = query.value.get('ownerId'), agentId = query.value.get('agentId'), state = query.value.get('state');
  if (ownerId !== null && !check.identifier(ownerId).ok || agentId !== null && !check.identifier(agentId).ok
    || state !== null && !publicationState(state).ok) return failure('invalid', 'Invalid publication filter');
  return success({ ...page.value, search: search.value, ...(ownerId === null ? {} : { ownerId }), ...(agentId === null ? {} : { agentId }),
    ...(state === null ? {} : { state: state as 'staging' | 'published' | 'deleted' }) });
}
