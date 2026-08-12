import type {
  Knex
} from "knex";
import type {
  LoginProvider,
  LoginProviderState
} from "./login-provider.js";

export async function upsertLoginProviders(
  database: Knex,
  providers: readonly LoginProvider[]
): Promise<void> {
  await database.transaction(async (transaction) => {
    for (const provider of providers) {
      await transaction("login_providers")
        .insert({
          tenant_id: provider.tenantId,
          provider_id: provider.providerId,
          display_name: provider.displayName,
          configuration_id: provider.configurationId,
          configuration_version_id: provider.configurationVersionId,
          secret_id: provider.secretId,
          secret_version_id: provider.secretVersionId,
          state: stateValue(provider.state),
          revision: provider.revision
        })
        .onConflict(["tenant_id", "provider_id"])
        .merge();
    }
  });
}

function stateValue(state: LoginProviderState): number {
  switch (state) {
    case "active":
      return 1;
    case "disabled":
      return 2;
    case "deleted":
      return 3;
  }
}
