import type {
  Knex
} from "knex";
import type {
  WorkspaceLoginProviderAdmission
} from "./workspace-login-provider-admission.js";

export async function replaceWorkspaceLoginProviderAdmissions(
  database: Knex,
  admissions: readonly WorkspaceLoginProviderAdmission[]
): Promise<void> {
  await database.transaction(async (transaction) => {
    await transaction("workspace_login_provider_admissions").delete();
    if (admissions.length === 0) {
      return;
    }
    await transaction("workspace_login_provider_admissions").insert(
      admissions.map((admission) => ({
        tenant_id: admission.tenantId,
        workspace_id: admission.workspaceId,
        provider_id: admission.providerId
      })));
  });
}
