import { readJson } from '@ctlflow/crossfire-adapter-filesystem/index';
import { config } from './config.js';
import { get } from 'node:http';
import { fileURLToPath } from 'node:url';

export async function verifyContainerHealth(host: string, port = 8080): Promise<void> {
  for (const path of ['/api/health', '/_matrix/client/versions']) await new Promise<void>((resolve, reject) => {
    const request = get({ hostname: '127.0.0.1', port, path, headers: { Host: host }, agent: false, signal: AbortSignal.timeout(3000) }, response => {
      const status = response.statusCode; response.destroy();
      if (status !== 200) reject(new Error('Container readiness failed: ' + path + ' returned ' + status));
      else resolve();
    });
    request.once('error', reject);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const selected = config(readJson('/runtime/config.json'));
  if (!selected.ok) throw new Error(selected.error.message);
  await verifyContainerHealth(new URL(selected.value.publicOrigin).host);
}
