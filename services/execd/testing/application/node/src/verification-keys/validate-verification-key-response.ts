import {
  createPublicKey
} from "node:crypto";
import {
  VerificationKeyAlgorithm,
  type GetInvocationVerificationKeysResponse
} from "../generated/v1/identityd.js";
import {
  decodeBase64Url
} from "../tokens/decode-base64-url.js";

const maximumKeyCacheLifetimeMilliseconds = 5 * 60_000;

export function validateVerificationKeyResponse(
  response: GetInvocationVerificationKeysResponse,
  receivedAtMs: number
): number {
  if (response.keys.length < 1
      || response.keys.length > 8
      || !(response.expiresAt instanceof Date)) {
    throw new TypeError("verification key state is invalid");
  }

  const expiresAtMs = response.expiresAt.getTime();
  if (!Number.isFinite(expiresAtMs)
      || expiresAtMs <= receivedAtMs
      || expiresAtMs > receivedAtMs + maximumKeyCacheLifetimeMilliseconds) {
    throw new TypeError("verification key expiry is invalid");
  }

  const keyIds = new Set<string>();
  let previousKeyId: string | undefined;
  for (const key of response.keys) {
    const modulus = decodeBase64Url(key.modulusBase64url);
    const exponent = decodeBase64Url(key.exponentBase64url);
    if (key.algorithm
          !== VerificationKeyAlgorithm.VERIFICATION_KEY_ALGORITHM_RS256
        || !isVisibleAscii(key.keyId, 128)
        || keyIds.has(key.keyId)
        || (previousKeyId !== undefined
          && key.keyId <= previousKeyId)
        || modulus.length < 128
        || modulus.length > 1_024
        || exponent.length < 1
        || exponent.length > 8) {
      throw new TypeError("verification key is invalid");
    }
    try {
      createPublicKey({
        format: "jwk",
        key: {
          kty: "RSA",
          n: key.modulusBase64url,
          e: key.exponentBase64url
        }
      });
    } catch (error) {
      throw new TypeError("verification key is invalid", { cause: error });
    }
    keyIds.add(key.keyId);
    previousKeyId = key.keyId;
  }

  return expiresAtMs;
}

function isVisibleAscii(value: string, maximumLength: number): boolean {
  return value.length >= 1
    && value.length <= maximumLength
    && [...value].every(
      (character) => character >= "!" && character <= "~");
}
