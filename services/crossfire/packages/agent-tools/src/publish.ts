import { publicationSource } from '@ctlflow/crossfire-adapter-filesystem/publication/source';
import { createClient } from '@ctlflow/crossfire-adapter-crossfire/client';
import { operations } from '@ctlflow/crossfire-contracts/rest/operations';
import type { Profile } from '@ctlflow/crossfire-contracts/client';
import { failure, success } from '@ctlflow/crossfire-kernel/result';

export async function publishReport(profile: Profile, directory: string, title: string) {
  const source = await publicationSource(directory); if (!source.ok) return source;
  let client: ReturnType<typeof createClient>;
  try { client = createClient({ origin: profile.settings.homeserver, token: profile.account.access_token }); }
  catch { return failure('invalid', 'Report publication requires a valid HTTPS Crossfire origin or an explicit loopback development origin'); }
  const created = await client.call(operations.createPublication, {}, { title, files: source.value.files }); if (!created.ok) return created;
  const report = created.value.data;
  for (const file of report.files) {
    const uploaded = await client.call(operations.uploadPublicationFile, { publicationId: report.id, fileId: file.id }, source.value.read(file));
    if (!uploaded.ok) return failure(uploaded.error.code, 'Report ' + report.id + ' remains private staging and expires automatically: ' + uploaded.error.message);
  }
  const committed = await client.call(operations.commitPublication, { publicationId: report.id }, { expectedRevision: report.revision });
  if (!committed.ok) return failure(committed.error.code, 'Report ' + report.id + ' has an uncertain or incomplete commit: ' + committed.error.message);
  if (committed.value.data.state !== 'published' || committed.value.data.url === null) return failure('native', 'Report commit did not return a published public URL');
  return success({ publicationId: report.id, title: committed.value.data.title, url: committed.value.data.url,
    totalBytes: committed.value.data.totalBytes, fileCount: committed.value.data.fileCount, public: true });
}
