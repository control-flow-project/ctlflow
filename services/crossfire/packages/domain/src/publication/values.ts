import { failure, success, type Result } from '@crossfire/kernel/result';

export const PUBLICATION_LIMITS = { files: 512, fileBytes: 8 * 1024 * 1024, bundleBytes: 32 * 1024 * 1024,
  stagingMilliseconds: 3600_000, instanceBytes: 1024 * 1024 * 1024, agentBytes: 128 * 1024 * 1024,
  instanceCount: 4096, agentCount: 128, uploads: 8 } as const;
export const PUBLICATION_MEDIA = {
  html: 'text/html', css: 'text/css', js: 'text/javascript', mjs: 'text/javascript', json: 'application/json',
  txt: 'text/plain', csv: 'text/csv', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml', ico: 'image/x-icon',
  woff: 'font/woff', woff2: 'font/woff2', pdf: 'application/pdf',
} as const;
export type PublicationState = 'staging' | 'published' | 'deleted';
export type PublicationFileInput = { path: string; mediaType: string; bytes: number; sha256: string };
export type PublicationCreation = { title: string; files: PublicationFileInput[] };
export type Publication = { id: string; agentId: string; publicKey: string; title: string; state: PublicationState;
  revision: number; createdAt: number; expiresAt: number; publishedAt: number | null; deletedAt: number | null;
  cleanedAt: number | null; totalBytes: number; fileCount: number };
export type PublicationFile = PublicationFileInput & { id: string; publicationId: string; uploaded: boolean };
export type PublicationSummary = Omit<Publication, 'publicKey' | 'cleanedAt'> & { agentName: string; ownerId: string;
  ownerName: string; url: string | null; allowedActions: string[] };
export type PublicationDetails = PublicationSummary & { files: Omit<PublicationFile, 'publicationId'>[] };
export type PublicationQuery = { page: number; pageSize: number; search: string; state?: PublicationState; agentId?: string; ownerId?: string };
export type PublicationBudget = { instanceBytes: number; agentBytes: number; instanceCount: number; agentCount: number; uploads: number };

export function publicationPath(value: string): Result<string> {
  if (value.length < 1 || value.length > 240 || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/u.test(value)
    || value.split('/').some(part => !/^[A-Za-z0-9]/u.test(part) || part.length > 100 || part.endsWith('.')))
    return failure('invalid', 'Use a relative report path with letters, digits, dots, underscores, hyphens and forward slashes');
  return success(value);
}
export function publicationMedia(path: string): Result<string> {
  const suffix = path.slice(path.lastIndexOf('.') + 1);
  const media = Object.entries(PUBLICATION_MEDIA).find(([extension]) => extension === suffix)?.[1];
  return media ? success(media) : failure('invalid', 'Unsupported static report file type');
}
export function validatePublication(input: PublicationCreation): Result<number> {
  if (!input.title.trim() || input.title.length > 200 || /[\u0000-\u001f\u007f]/u.test(input.title)
    || input.files.length < 1 || input.files.length > PUBLICATION_LIMITS.files) return failure('invalid', 'A title and bounded static file manifest are required');
  const paths = new Set<string>(); let total = 0;
  for (const file of input.files) {
    const path = publicationPath(file.path), media = publicationMedia(file.path);
    if (!path.ok) return path; if (!media.ok) return media;
    if (media.value !== file.mediaType || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || file.bytes > PUBLICATION_LIMITS.fileBytes
      || !/^[a-f0-9]{64}$/u.test(file.sha256)) return failure('invalid', 'File size, MIME type or digest does not match the static manifest');
    if (paths.has(file.path.toLowerCase())) return failure('invalid', 'Report paths must be unique, including case');
    paths.add(file.path.toLowerCase()); total += file.bytes;
  }
  for (const path of paths) for (const other of paths) if (other.startsWith(path + '/')) return failure('invalid', 'A file cannot also be a directory');
  return paths.has('index.html') && input.files.some(file => file.path === 'index.html') && total <= PUBLICATION_LIMITS.bundleBytes
    ? success(total) : failure('invalid', 'A report requires index.html and at most 32 MiB of static files');
}
