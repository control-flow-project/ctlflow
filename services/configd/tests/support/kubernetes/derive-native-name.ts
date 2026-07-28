import {
  createHash
} from "node:crypto";

export function deriveNativeName(
  domain: string,
  prefix: string,
  identifier: string
): string {
  const domainBytes = Buffer.from(domain, "ascii");
  const identifierBytes = Buffer.from(identifier, "utf8");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(identifierBytes.length);
  const digest = createHash("sha256")
    .update(domainBytes)
    .update(Buffer.of(0))
    .update(length)
    .update(identifierBytes)
    .digest();
  return prefix + digest.subarray(0, 16).toString("hex");
}
