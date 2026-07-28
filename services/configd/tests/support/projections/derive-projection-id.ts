import {
  createHash
} from "node:crypto";
import type {
  ConsumerBinding
} from "../../generated/v1/configd.js";

const alphabet = "abcdefghijklmnopqrstuvwxyz234567";

export function deriveProjectionId(
  kind: "configuration" | "secret",
  binding: ConsumerBinding
): string {
  const chunks = [
    Buffer.from("ctlflow.configuration.v1.Projection", "ascii"),
    Buffer.of(0),
    Buffer.of(kind === "configuration" ? 1 : 2),
    field(binding.placement?.placementId ?? "")
  ];
  const placement = binding.placement;
  if (placement?.global !== undefined) {
    chunks.push(Buffer.of(1));
  } else if (placement?.tenant !== undefined) {
    chunks.push(
      Buffer.of(2),
      field(placement.tenant.tenantId));
  } else if (placement?.workspace !== undefined) {
    chunks.push(
      Buffer.of(3),
      field(placement.workspace.tenantId),
      field(placement.workspace.workspaceId));
  } else if (placement?.user !== undefined) {
    chunks.push(
      Buffer.of(4),
      field(placement.user.tenantId),
      field(placement.user.accountPrincipalId));
  } else {
    throw new Error("Projection binding has no scope");
  }
  chunks.push(
    field(binding.consumerId),
    field(binding.purpose));
  return `prj_${base32(createHash("sha256")
    .update(Buffer.concat(chunks))
    .digest())}`;
}

function field(value: string): Buffer {
  const bytes = Buffer.from(value, "utf8");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(bytes.length);
  return Buffer.concat([length, bytes]);
}

function base32(value: Buffer): string {
  let buffer = 0;
  let bits = 0;
  let result = "";
  for (const byte of value) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      result += alphabet[(buffer >> bits) & 31];
    }
  }
  if (bits > 0) {
    result += alphabet[(buffer << (5 - bits)) & 31];
  }
  return result;
}
