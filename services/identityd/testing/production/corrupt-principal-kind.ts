import type {
  Knex
} from "knex";

export async function corruptPrincipalKind(
  database: Knex,
  principalId: string,
  kind: "human" | "service"
): Promise<void> {
  await database.raw("PRAGMA ignore_check_constraints = ON");
  try {
    const updated = await database("accounts")
      .where({ account_id: principalId })
      .update({ kind: kind === "human" ? 1 : 2 });
    if (updated !== 1) {
      throw new Error("Principal fixture does not exist");
    }
  } finally {
    await database.raw("PRAGMA ignore_check_constraints = OFF");
  }
}
