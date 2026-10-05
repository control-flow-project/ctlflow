import { failure, success, type Result } from '@crossfire/kernel/result';
import { PUBLICATION_LIMITS, PUBLICATION_MEDIA, type PublicationCreation } from './values.js';

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
