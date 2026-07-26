import { createPublicKey, type KeyObject } from "node:crypto";
import { readFile } from "node:fs/promises";

interface JsonWebKey {
  readonly kty?: unknown;
  readonly alg?: unknown;
  readonly use?: unknown;
  readonly kid?: unknown;
  readonly n?: unknown;
  readonly e?: unknown;
}

interface JsonWebKeySet {
  readonly keys?: unknown;
}

export async function loadWorkloadVerificationKeys(
  path: string
): Promise<ReadonlyMap<string, KeyObject>> {
  const encoded = await readFile(path);
  if (encoded.length < 1 || encoded.length > 1024 * 1024) {
    throw new Error("Workload verification-key set has an invalid size");
  }

  const document = JSON.parse(encoded.toString("utf8")) as JsonWebKeySet;
  if (!Array.isArray(document.keys)) {
    throw new Error("Workload verification-key set has no keys");
  }

  const keys = new Map<string, KeyObject>();
  for (const value of document.keys) {
    const key = value as JsonWebKey;
    if (key.kty !== "RSA"
        || key.alg !== undefined && key.alg !== "RS256"
        || key.use !== undefined && key.use !== "sig"
        || typeof key.kid !== "string"
        || key.kid.length < 1
        || key.kid.length > 128
        || typeof key.n !== "string"
        || typeof key.e !== "string"
        || keys.has(key.kid)) {
      throw new Error("Workload verification-key set is invalid");
    }

    keys.set(key.kid, createPublicKey({
      key: {
        kty: "RSA",
        kid: key.kid,
        alg: "RS256",
        use: "sig",
        n: key.n,
        e: key.e
      },
      format: "jwk"
    }));
  }

  if (keys.size === 0) {
    throw new Error("Workload verification-key set has no admitted key");
  }

  return keys;
}
