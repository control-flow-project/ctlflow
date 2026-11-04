import { decodeUtf8 } from '@ctlflow/crossfire-kernel/bytes';
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import { join } from "node:path";
import { ARTIFACTS, manifest, MAX_ARTIFACT_BYTES, type ArtifactName, type Manifest } from "@ctlflow/crossfire-contracts/release";

export function artifactHash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function releaseHash(files: Record<ArtifactName, Uint8Array>): string {
  const hash = createHash("sha256");
  for (const name of ARTIFACTS) hash.update(name).update("\0").update(artifactHash(files[name])).update("\0");
  return hash.digest("hex").slice(0, 24);
}

function read(path: string, maximum: number): Buffer {
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = fstatSync(descriptor);
    if (!info.isFile() || info.size < 1 || info.size > maximum) throw new Error("Invalid published artifact file");
    const bytes = Buffer.alloc(info.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const received = readSync(descriptor, bytes, length, bytes.length - length, null);
      if (!received) break;
      length += received;
    }
    if (length !== info.size || fstatSync(descriptor).size !== info.size) throw new Error("Published artifact changed during verification");
    return bytes.subarray(0, length);
  } finally { closeSync(descriptor); }
}

export function loadRelease(directory: string) {
  const bytes = read(join(directory, "manifest.json"), 16 * 1024);
  const result = manifest(JSON.parse(decodeUtf8(bytes)) as unknown);
  if (!result.ok) throw new Error(result.error.message);
  const metadata = result.value;
  const files = Object.fromEntries(ARTIFACTS.map(name => {
    const content = read(join(directory, name), MAX_ARTIFACT_BYTES);
    if (content.byteLength !== metadata.artifacts[name].bytes || artifactHash(content) !== metadata.artifacts[name].sha256) {
      throw new Error("Published artifact does not match its manifest");
    }
    return [name, content];
  })) as Record<ArtifactName, Buffer>;
  if (metadata.release !== metadata.version + "-" + releaseHash(files)) throw new Error("Release content identity does not match");
  return { manifest: metadata, files };
}

export type Release = { manifest: Manifest; files: Record<ArtifactName, Buffer> };
