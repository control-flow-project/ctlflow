import {
  generateKeyPairSync
} from "node:crypto";
import {
  writeFile
} from "node:fs/promises";
import type {
  StartIdentitydProductionServiceOptions
} from "@ctlflow/identityd/testing/production";

type SigningProvision =
  StartIdentitydProductionServiceOptions["signing"];

export function createInvocationSigning(): SigningProvision {
  const pair = generateKeyPairSync("rsa", {
    modulusLength: 2_048,
    publicExponent: 65_537
  });
  const publicKey = pair.publicKey.export({ format: "jwk" });
  if (publicKey.kty !== "RSA"
      || typeof publicKey.n !== "string"
      || typeof publicKey.e !== "string") {
    throw new Error("Invocation signing key is invalid");
  }
  const privateKey = pair.privateKey.export({
    format: "pem",
    type: "pkcs8"
  });
  return {
    verificationKey: {
      keyId: "edged-identity-test-key",
      algorithm: "RS256",
      modulusBase64url: publicKey.n,
      exponentBase64url: publicKey.e
    },
    writePrivateKey: async (path) => {
      await writeFile(path, privateKey, { mode: 0o600 });
    }
  };
}
