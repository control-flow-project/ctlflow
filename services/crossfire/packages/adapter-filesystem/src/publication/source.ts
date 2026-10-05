import { lstat, opendir, open } from 'node:fs/promises';
import { constants, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { failure, success } from '@crossfire/kernel/result';
import type { BinaryInput } from '@crossfire/kernel/bytes';
import { PUBLICATION_LIMITS, publicationPath, publicationMedia, type PublicationFileInput } from '@crossfire/domain/publication/values';

export async function publicationSource(directory: string) {
  try {
    const root = resolve(directory);
    if (realpathSync(root) !== root || !(await lstat(root)).isDirectory()) return failure('invalid', 'Report source must be a real directory without symlink ancestors');
    const files: PublicationFileInput[] = []; let total = 0, entries = 0;
    async function walk(relative: string): Promise<void> {
      const path = join(root, relative);
      if (realpathSync(path) !== path) throw new Error('Report directory changed or traverses a symlink');
      for await (const entry of await opendir(path)) {
        if (++entries > PUBLICATION_LIMITS.files * 2) throw new Error('Report contains too many files or directories');
        const name = relative ? relative + '/' + entry.name : entry.name;
        if (!publicationPath(name).ok) throw new Error('Report contains an invalid relative path');
        if (entry.isDirectory()) await walk(name);
        else if (entry.isFile()) {
          if (files.length >= PUBLICATION_LIMITS.files) throw new Error('Report contains too many files');
          const media = publicationMedia(name); if (!media.ok) throw new Error(media.error.message);
          const handle = await open(join(root, name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
          try {
            const information = await handle.stat();
            if (!information.isFile() || information.nlink !== 1 || information.size > PUBLICATION_LIMITS.fileBytes) throw new Error('Report requires bounded regular files without hardlinks');
            total += information.size; if (total > PUBLICATION_LIMITS.bundleBytes) throw new Error('Report exceeds the bundle limit');
            const digest = createHash('sha256'); let offset = 0;
            while (offset < information.size) {
              const bytes = new Uint8Array(Math.min(65536, information.size - offset));
              const result = await handle.read(bytes, 0, bytes.length, offset);
              if (!result.bytesRead) throw new Error('Report source changed during inspection');
              offset += result.bytesRead; digest.update(bytes.subarray(0, result.bytesRead));
            }
            const current = await handle.stat();
            if (current.size !== information.size || current.mtimeMs !== information.mtimeMs || current.ctimeMs !== information.ctimeMs) throw new Error('Report source changed during inspection');
            files.push({ path: name, mediaType: media.value, bytes: information.size, sha256: digest.digest('hex') });
          } finally { await handle.close(); }
        } else throw new Error('Report source cannot contain symlinks or special files');
      }
    }
    await walk(''); files.sort((left, right) => left.path.localeCompare(right.path));
    function read(file: PublicationFileInput): BinaryInput {
      return { byteLength: file.bytes, chunks: { async *[Symbol.asyncIterator]() {
        const path = join(root, file.path);
        if (!publicationPath(file.path).ok || realpathSync(path) !== path) throw new Error('Report source changed or traverses a symlink');
        const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        try {
          const info = await handle.stat();
          if (!info.isFile() || info.nlink !== 1 || info.size !== file.bytes) throw new Error('Report source changed');
          let offset = 0;
          while (offset < file.bytes) {
            const bytes = new Uint8Array(Math.min(65536, file.bytes - offset));
            const result = await handle.read(bytes, 0, bytes.length, offset);
            if (!result.bytesRead) throw new Error('Report source changed');
            offset += result.bytesRead; yield bytes.subarray(0, result.bytesRead);
          }
          const current = await handle.stat();
          if (current.size !== info.size || current.mtimeMs !== info.mtimeMs || current.ctimeMs !== info.ctimeMs) throw new Error('Report source changed');
        } finally { await handle.close(); }
      } } };
    }
    return success({ files, read });
  } catch { return failure('invalid', 'Report source is invalid, changed, unreadable or exceeds its static-file limits'); }
}
