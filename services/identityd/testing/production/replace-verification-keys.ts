import type {
  Knex
} from "knex";
import type {
  InvocationVerificationKeyResponse
} from "./invocation-verification-key.js";

export async function replaceVerificationKeys(
  database: Knex,
  response: InvocationVerificationKeyResponse
): Promise<void> {
  await database.transaction(async (transaction) => {
    await transaction("invocation_verification_keys").delete();
    if (response.keys.length === 0) {
      return;
    }

    await transaction("invocation_verification_keys").insert(
      response.keys.map((key, index) => ({
        key_id: key.keyId,
        algorithm: key.algorithm,
        modulus_base64url: key.modulusBase64url,
        exponent_base64url: key.exponentBase64url,
        state: 1,
        revision: index + 1
      })));
  });
}
