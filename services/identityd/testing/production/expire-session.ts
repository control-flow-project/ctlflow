import {
  createHash
} from "node:crypto";
import type {
  Knex
} from "knex";

export async function expireSession(
  database: Knex,
  credential: Uint8Array
): Promise<void> {
  const digest = createHash("sha256")
    .update(credential)
    .digest("hex");
  const now = Date.now();
  const updated = await database("sessions")
    .where({ credential_digest: digest })
    .update({
      created_at_unix_ms: now - 2_000,
      expires_at_unix_ms: now - 1_000
    });
  if (updated !== 1) {
    throw new Error("Session credential was not found");
  }
}
