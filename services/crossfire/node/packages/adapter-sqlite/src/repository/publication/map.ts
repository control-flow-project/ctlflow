import type { Publication, PublicationFile } from '@ctlflow/crossfire-domain/publication/values';
import type { Tables } from '../../schema/tables.js';
export function mapPublication(row: Tables['publication']): Publication {
  return { id: row.id, agentId: row.agent_id, publicKey: row.public_key, title: row.title, state: row.state, revision: row.revision,
    createdAt: row.created_at, expiresAt: row.expires_at, publishedAt: row.published_at, deletedAt: row.deleted_at,
    cleanedAt: row.cleaned_at, totalBytes: row.total_bytes, fileCount: row.file_count };
}
export function mapPublicationFile(row: Tables['publication_file']): PublicationFile {
  if (![0, 1].includes(row.uploaded)) throw new Error('Invalid stored report upload state');
  return { id: row.id, publicationId: row.publication_id, path: row.path, mediaType: row.media_type, bytes: row.bytes,
    sha256: row.sha256, uploaded: row.uploaded === 1 };
}
