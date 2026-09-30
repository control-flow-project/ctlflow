import type { ServerResponse } from 'node:http';
import { artifactName } from '@crossfire/contracts/release';
import type { Release } from '@crossfire/adapter-filesystem/release';

export function serveArtifact(release: Release, method: string, path: string, response: ServerResponse): boolean {
  if (method !== 'GET' && method !== 'HEAD') return false;
  const prefix = '/onboarding/' + release.manifest.release + '/';
  if (!path.startsWith(prefix)) return false;
  const name = path.slice(prefix.length);
  const bytes = name === 'manifest.json' ? Buffer.from(JSON.stringify(release.manifest) + '\n')
    : artifactName(name) ? release.files[name] : undefined;
  if (!bytes) return false;
  if (name === 'runcodex.sh') response.setHeader('Content-Disposition', 'attachment; filename="runcodex.sh"');
  response.writeHead(200, { 'Content-Type': name === 'manifest.json' ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'Content-Length': bytes.length, 'Cache-Control': 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'" });
  response.end(method === 'HEAD' ? undefined : bytes);
  return true;
}
