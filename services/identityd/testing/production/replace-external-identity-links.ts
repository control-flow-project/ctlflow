import type {
  Knex
} from "knex";
import type {
  ExternalIdentityLink
} from "./external-identity-link.js";

export async function replaceExternalIdentityLinks(
  database: Knex,
  links: readonly ExternalIdentityLink[]
): Promise<void> {
  await database.transaction(async (transaction) => {
    await transaction("external_identity_links").delete();
    if (links.length === 0) {
      return;
    }
    await transaction("external_identity_links").insert(
      links.map((link) => ({
        tenant_id: link.tenantId,
        provider_id: link.providerId,
        provider_subject: link.providerSubject,
        account_id: link.accountId,
        revision: link.revision
      })));
  });
}
