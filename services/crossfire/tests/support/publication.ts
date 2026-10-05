import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import type { TestContext } from 'node:test';
import { cleanup } from '@crossfire/test-support/cleanup';
import { createClient } from '@crossfire/adapter-crossfire/client';
import { binaryBytes } from '@crossfire/kernel/bytes';
import { operations } from '@crossfire/contracts/rest/operations';
import { publicationMedia } from '@crossfire/domain/publication/validation';
import { createContentServer } from '../../apps/server/src/content-server.js';
import { COOKIE_NAME } from '../../apps/server/src/http/transport.js';
import type { Application } from '../../apps/server/src/composition.js';
import { value } from './application.js';

export async function contentFixture(scope: TestContext, application: Application) {
  const server = createContentServer(application); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert(address && typeof address !== 'string');
  const origin = 'http://localhost:' + address.port; application.config.contentOrigin = origin;
  cleanup(scope, async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  return { origin, server };
}
export function publicationHeaders(origin: string, session: { secret: string; csrfSecret: string }) {
  return { Cookie: COOKIE_NAME + '=' + session.secret, Origin: origin, 'X-Crossfire-CSRF': session.csrfSecret };
}
export async function publishFixture(origin: string, token: string, files: Record<string, string | Uint8Array>) {
  const client = createClient({ origin, token });
  const bytes = Object.fromEntries(Object.entries(files).map(([path, data]) => [path, typeof data === 'string' ? Buffer.from(data) : data]));
  const manifest = Object.entries(bytes).map(([path, data]) => ({ path, mediaType: value(publicationMedia(path)), bytes: data.byteLength,
    sha256: createHash('sha256').update(data).digest('hex') }));
  const report = value(await client.call(operations.createPublication, {}, { title: 'Public report', files: manifest })).data;
  for (const file of report.files) value(await client.call(operations.uploadPublicationFile, { publicationId: report.id, fileId: file.id }, binaryBytes(bytes[file.path]!)));
  return value(await client.call(operations.commitPublication, { publicationId: report.id }, { expectedRevision: report.revision })).data;
}
