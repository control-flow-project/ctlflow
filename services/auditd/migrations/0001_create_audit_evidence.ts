import type { Knex } from "knex";

const immutableTables = [
  "audit_events",
  "audit_tenant_mutations",
  "audit_workspace_mutations",
  "audit_identity_sessions",
  "audit_identity_memberships",
  "audit_identity_groups",
  "audit_identity_group_members",
  "audit_identity_virtual_principals",
  "audit_identity_external_links",
  "audit_identity_login_providers",
  "audit_identity_workspace_provider_admissions",
  "audit_package_declarations",
  "audit_app_mutations",
  "audit_configuration_publications",
  "audit_secret_publications",
  "audit_projection_mutations",
  "audit_placement_mutations",
  "audit_workload_mutations",
  "audit_run_mutations"
] as const;

export async function up(knex: Knex): Promise<void> {
  await createEvents(knex);
  await createPartitionHeads(knex);
  await createTenancyDetails(knex);
  await createIdentityDetails(knex);
  await createPackageDetails(knex);
  await createConfigDetails(knex);
  await createExecutionDetails(knex);
}

export async function down(knex: Knex): Promise<void> {
  for (const table of [...immutableTables].reverse()) {
    if (table !== "audit_events") {
      await knex.schema.dropTableIfExists(table);
    }
  }
  await knex.schema.dropTableIfExists("audit_partition_heads");
  await knex.schema.dropTableIfExists("audit_events");
}

async function createEvents(knex: Knex): Promise<void> {
  await knex.schema.createTable("audit_events", (table) => {
    table.string("event_key", 64).primary();
    table.string("source_principal", 32).notNullable();
    table.string("source_subject", 149).notNullable();
    table.string("source_event_id", 36).notNullable();
    table.bigInteger("occurred_at_seconds").notNullable();
    table.integer("occurred_at_nanoseconds").notNullable();
    table.integer("attribution_kind").notNullable();
    table.string("operator_common_name", 253).nullable();
    table.string("workload_subject", 149).nullable();
    table.string("actor_principal_id", 256).nullable();
    table.string("attached_account_principal_id", 256).nullable();
    table.string("invocation_workload_subject", 149).nullable();
    table.integer("partition_kind").notNullable();
    table.string("partition_tenant_id", 64).nullable();
    table.string("partition_key", 71).notNullable();
    table.string("trace_id", 32).notNullable();
    table.string("span_id", 16).notNullable();
    table.integer("detail_kind").notNullable();
    table.string("content_hash", 64).notNullable();
    table.bigInteger("accepted_at_seconds").notNullable();
    table.integer("accepted_at_nanoseconds").notNullable();
    table.bigInteger("partition_cursor").notNullable();
    table.unique(
      ["source_principal", "source_event_id"],
      { indexName: "audit_events_source_event_uidx" });
    table.unique(
      ["partition_key", "partition_cursor"],
      { indexName: "audit_events_partition_cursor_uidx" });
    table.check(hexCheck("event_key", 64));
    table.check(
      "source_principal IN "
      + "('SERVICE/svc_tenantd','SERVICE/svc_identityd',"
      + "'SERVICE/svc_pkgd','SERVICE/svc_configd','SERVICE/svc_execd')");
    table.check(workloadSubjectCheck("source_subject"));
    table.check(
      "length(source_event_id) = 36 "
      + "AND substr(source_event_id, 1, 4) = 'evt_' "
      + "AND substr(source_event_id, 5) NOT GLOB '*[^a-f0-9]*'");
    table.check(
      "occurred_at_seconds BETWEEN -62135596800 AND 253402300799");
    table.check("occurred_at_nanoseconds BETWEEN 0 AND 999999999");
    table.check(attributionCheck());
    table.check(partitionCheck());
    table.check(
      `${hexCheck("trace_id", 32)} `
      + `AND trace_id <> '${"0".repeat(32)}'`);
    table.check(
      `${hexCheck("span_id", 16)} `
      + `AND span_id <> '${"0".repeat(16)}'`);
    table.check("detail_kind BETWEEN 1 AND 18");
    table.check(hexCheck("content_hash", 64));
    table.check("accepted_at_seconds > 0");
    table.check("accepted_at_nanoseconds BETWEEN 0 AND 999999999");
    table.check("partition_cursor > 0");
  });
}

async function createPartitionHeads(knex: Knex): Promise<void> {
  await knex.schema.createTable("audit_partition_heads", (table) => {
    table.string("partition_key", 71).primary();
    table.integer("partition_kind").notNullable();
    table.string("tenant_id", 64).nullable();
    table.bigInteger("current_cursor").notNullable();
    table.check(
      "(partition_kind = 1 AND tenant_id IS NULL "
      + "AND partition_key = 'global') OR "
      + "(partition_kind = 2 AND tenant_id IS NOT NULL "
      + "AND partition_key = 'tenant:' || tenant_id)");
    table.check(
      "tenant_id IS NULL OR "
      + canonicalIdCheck("tenant_id", 64));
    table.check("current_cursor > 0");
  });
}

async function createTenancyDetails(knex: Knex): Promise<void> {
  await createDetailTable(knex, "audit_tenant_mutations", (table) => {
    table.integer("action").notNullable();
    table.bigInteger("resource_revision").notNullable();
    table.integer("resulting_state").notNullable();
    table.check("action BETWEEN 1 AND 3");
    table.check("resulting_state BETWEEN 1 AND 3");
    table.check(
      "(action = 1 AND resource_revision = 1 AND resulting_state = 1) "
      + "OR (action IN (2, 3) AND resource_revision >= 2)");
  });
  await createDetailTable(knex, "audit_workspace_mutations", (table) => {
    table.string("workspace_id", 64).notNullable();
    table.integer("action").notNullable();
    table.bigInteger("resource_revision").notNullable();
    table.integer("resulting_state").notNullable();
    table.check(canonicalIdCheck("workspace_id", 64));
    table.check("action BETWEEN 1 AND 3");
    table.check("resulting_state BETWEEN 1 AND 3");
    table.check(
      "(action = 1 AND resource_revision = 1 AND resulting_state = 1) "
      + "OR (action IN (2, 3) AND resource_revision >= 2)");
  });
}

async function createIdentityDetails(knex: Knex): Promise<void> {
  await createDetailTable(knex, "audit_identity_sessions", (table) => {
    table.string("session_id", 32).notNullable();
    table.string("human_account_principal_id", 256).notNullable();
    table.bigInteger("session_revision").notNullable();
    table.integer("action").notNullable();
    table.check(hexCheck("session_id", 32));
    table.check(accountPrincipalCheck("human_account_principal_id", true));
    table.check(
      "(action = 1 AND session_revision = 1) "
      + "OR (action = 2 AND session_revision = 2)");
  });
  await createDetailTable(knex, "audit_identity_memberships", (table) => {
    table.string("account_principal_id", 256).notNullable();
    table.string("workspace_id", 64).nullable();
    table.bigInteger("membership_revision").notNullable();
    table.integer("action").notNullable();
    table.integer("account_created").notNullable();
    table.check(accountPrincipalCheck("account_principal_id", false));
    table.check(
      "workspace_id IS NULL OR "
      + canonicalIdCheck("workspace_id", 64));
    table.check("membership_revision > 0");
    table.check("action BETWEEN 1 AND 2");
    table.check("account_created IN (0, 1)");
    table.check(
      "account_created = 0 OR "
      + "(action = 1 AND workspace_id IS NULL "
      + "AND membership_revision = 1)");
  });
  await createDetailTable(knex, "audit_identity_groups", (table) => {
    table.string("group_id", 64).notNullable();
    table.string("workspace_id", 64).nullable();
    table.integer("action").notNullable();
    table.check(canonicalIdCheck("group_id", 64));
    table.check(
      "workspace_id IS NULL OR "
      + canonicalIdCheck("workspace_id", 64));
    table.check("action BETWEEN 1 AND 2");
  });
  await createDetailTable(
    knex,
    "audit_identity_group_members",
    (table) => {
      table.string("group_id", 64).notNullable();
      table.string("principal_id", 256).notNullable();
      table.string("workspace_id", 64).nullable();
      table.integer("action").notNullable();
      table.check(canonicalIdCheck("group_id", 64));
      table.check(principalCheck("principal_id"));
      table.check(
        "workspace_id IS NULL OR "
        + canonicalIdCheck("workspace_id", 64));
      table.check("action BETWEEN 1 AND 2");
    });
  await createDetailTable(
    knex,
    "audit_identity_virtual_principals",
    (table) => {
      table.string("principal_id", 256).notNullable();
      table.string("attached_account_principal_id", 256).notNullable();
      table.string("workspace_id", 64).nullable();
      table.bigInteger("principal_revision").notNullable();
      table.integer("enabled").notNullable();
      table.integer("action").notNullable();
      table.check(principalCheck("principal_id"));
      table.check("principal_id LIKE 'agent:%'");
      table.check(
        accountPrincipalCheck("attached_account_principal_id", false));
      table.check(
        "workspace_id IS NULL OR "
        + canonicalIdCheck("workspace_id", 64));
      table.check("enabled IN (0, 1)");
      table.check(
        "(action = 1 AND principal_revision = 1 AND enabled = 1) "
        + "OR (action = 2 AND principal_revision >= 2)");
    });
  await createDetailTable(
    knex,
    "audit_identity_external_links",
    (table) => {
      table.string("external_link_id", 36).notNullable();
      table.string("provider_id", 64).notNullable();
      table.string("human_account_principal_id", 256).notNullable();
      table.integer("action").notNullable();
      table.check("length(external_link_id) = 36");
      table.check("substr(external_link_id, 1, 4) = 'eil_'");
      table.check(
        "substr(external_link_id, 5) NOT GLOB '*[^a-f0-9]*'");
      table.check(canonicalIdCheck("provider_id", 64));
      table.check(accountPrincipalCheck(
        "human_account_principal_id",
        true));
      table.check("action BETWEEN 1 AND 2");
    });
  await createDetailTable(
    knex,
    "audit_identity_login_providers",
    (table) => {
      table.string("provider_id", 64).notNullable();
      table.bigInteger("provider_revision").notNullable();
      table.integer("resulting_state").notNullable();
      table.integer("action").notNullable();
      table.check(canonicalIdCheck("provider_id", 64));
      table.check("resulting_state BETWEEN 1 AND 3");
      table.check(
        "(action = 1 AND provider_revision = 1 "
        + "AND resulting_state = 1) OR "
        + "(action IN (2, 3) AND provider_revision >= 2)");
    });
  await createDetailTable(
    knex,
    "audit_identity_workspace_provider_admissions",
    (table) => {
      table.string("workspace_id", 64).notNullable();
      table.string("provider_id", 64).notNullable();
      table.integer("action").notNullable();
      table.check(canonicalIdCheck("workspace_id", 64));
      table.check(canonicalIdCheck("provider_id", 64));
      table.check("action BETWEEN 1 AND 2");
    });
}

async function createPackageDetails(knex: Knex): Promise<void> {
  await createDetailTable(knex, "audit_package_declarations", (table) => {
    table.string("package_id", 128).notNullable();
    table.bigInteger("generation").notNullable();
    table.check(packageIdCheck("package_id"));
    table.check("generation > 0");
  });
  await createDetailTable(knex, "audit_app_mutations", (table) => {
    table.string("app_id", 64).notNullable();
    createTargetColumns(table, "scope");
    table.string("placement_id", 64).notNullable();
    table.string("package_id", 128).notNullable();
    table.bigInteger("package_generation").notNullable();
    table.bigInteger("app_revision").notNullable();
    table.integer("action").notNullable();
    table.check(canonicalIdCheck("app_id", 64));
    table.check(targetCheck("scope"));
    table.check(canonicalIdCheck("placement_id", 64));
    table.check(packageIdCheck("package_id"));
    table.check("package_generation > 0");
    table.check(
      "(action = 1 AND app_revision = 1) "
      + "OR (action = 2 AND app_revision >= 2)");
  });
}

async function createConfigDetails(knex: Knex): Promise<void> {
  await createPublicationTable(
    knex,
    "audit_configuration_publications",
    "configuration");
  await createPublicationTable(
    knex,
    "audit_secret_publications",
    "secret");
  await createDetailTable(knex, "audit_projection_mutations", (table) => {
    table.string("projection_id", 56).notNullable();
    table.integer("action").notNullable();
    table.bigInteger("projection_revision").notNullable();
    table.integer("target_kind").notNullable();
    table.string("configuration_id", 64).nullable();
    table.string("configuration_version_id", 64).nullable();
    table.string("secret_id", 64).nullable();
    table.string("secret_version_id", 64).nullable();
    createBindingColumns(table);
    table.check(
      "length(projection_id) = 56 "
      + "AND substr(projection_id, 1, 4) = 'prj_' "
      + "AND substr(projection_id, 5) NOT GLOB '*[^a-z2-7]*'");
    table.check(
      "(action = 1 AND projection_revision = 1) "
      + "OR (action = 2 AND projection_revision >= 2)");
    table.check(
      "(target_kind = 1 AND configuration_id IS NOT NULL "
      + "AND configuration_version_id IS NOT NULL "
      + "AND secret_id IS NULL AND secret_version_id IS NULL) OR "
      + "(target_kind = 2 AND configuration_id IS NULL "
      + "AND configuration_version_id IS NULL "
      + "AND secret_id IS NOT NULL AND secret_version_id IS NOT NULL)");
    table.check(
      "configuration_id IS NULL OR "
      + canonicalIdCheck("configuration_id", 64));
    table.check(
      "configuration_version_id IS NULL OR "
      + canonicalIdCheck("configuration_version_id", 64));
    table.check(
      "secret_id IS NULL OR "
      + canonicalIdCheck("secret_id", 64));
    table.check(
      "secret_version_id IS NULL OR "
      + canonicalIdCheck("secret_version_id", 64));
    addBindingChecks(table);
  });
}

async function createPublicationTable(
  knex: Knex,
  tableName: string,
  kind: "configuration" | "secret"
): Promise<void> {
  await createDetailTable(knex, tableName, (table) => {
    table.string(`${kind}_id`, 64).notNullable();
    table.string(`${kind}_version_id`, 64).notNullable();
    createBindingColumns(table);
    table.bigInteger("identity_revision").notNullable();
    table.string("dependency_claim_id", 64).nullable();
    table.bigInteger("dependency_claim_revision").nullable();
    table.check(canonicalIdCheck(`${kind}_id`, 64));
    table.check(canonicalIdCheck(`${kind}_version_id`, 64));
    addBindingChecks(table);
    table.check("identity_revision > 0");
    table.check(
      "(dependency_claim_id IS NULL "
      + "AND dependency_claim_revision IS NULL) OR "
      + "(dependency_claim_id IS NOT NULL "
      + "AND dependency_claim_revision > 0)");
    table.check(
      "dependency_claim_id IS NULL OR "
      + "(length(dependency_claim_id) = 36 "
      + "AND substr(dependency_claim_id, 1, 4) = 'dpc-' "
      + "AND substr(dependency_claim_id, 5) "
      + "NOT GLOB '*[^a-f0-9]*')");
  });
}

async function createExecutionDetails(knex: Knex): Promise<void> {
  await createDetailTable(knex, "audit_placement_mutations", (table) => {
    table.string("placement_id", 64).notNullable();
    createTargetColumns(table, "target");
    table.integer("action").notNullable();
    table.bigInteger("placement_revision").notNullable();
    table.integer("resulting_desired_state").notNullable();
    table.check(canonicalIdCheck("placement_id", 64));
    table.check(targetCheck("target"));
    table.check(mutationRevisionCheck("placement_revision"));
    table.check("resulting_desired_state BETWEEN 1 AND 3");
  });
  await createDetailTable(knex, "audit_workload_mutations", (table) => {
    table.string("workload_id", 64).notNullable();
    table.string("placement_id", 64).notNullable();
    createTargetColumns(table, "placement_target");
    table.integer("action").notNullable();
    table.bigInteger("workload_revision").notNullable();
    table.integer("resulting_desired_state").notNullable();
    table.string("app_id", 64).notNullable();
    table.bigInteger("app_revision").notNullable();
    table.string("package_id", 128).notNullable();
    table.bigInteger("package_generation").notNullable();
    table.string("component_id", 64).notNullable();
    for (const column of [
      "workload_id", "placement_id", "app_id", "component_id"
    ]) {
      table.check(canonicalIdCheck(column, 64));
    }
    table.check(targetCheck("placement_target"));
    table.check(mutationRevisionCheck("workload_revision"));
    table.check("resulting_desired_state BETWEEN 1 AND 3");
    table.check("app_revision > 0");
    table.check(packageIdCheck("package_id"));
    table.check("package_generation > 0");
  });
  await createDetailTable(knex, "audit_run_mutations", (table) => {
    table.string("run_id", 128).notNullable();
    table.string("workload_id", 64).notNullable();
    table.string("placement_id", 64).notNullable();
    createTargetColumns(table, "placement_target");
    table.integer("action").notNullable();
    table.bigInteger("run_revision").notNullable();
    table.string("configured_actor_principal_id", 256).nullable();
    table.check(packageIdCheck("run_id"));
    table.check(canonicalIdCheck("workload_id", 64));
    table.check(canonicalIdCheck("placement_id", 64));
    table.check(targetCheck("placement_target"));
    table.check(
      "(action = 1 AND run_revision = 1) "
      + "OR (action = 2 AND run_revision >= 2)");
    table.check(
      "configured_actor_principal_id IS NULL OR "
      + principalCheck("configured_actor_principal_id"));
  });
}

async function createDetailTable(
  knex: Knex,
  name: string,
  configure: (table: Knex.CreateTableBuilder) => void
): Promise<void> {
  await knex.schema.createTable(name, (table) => {
    table.string("event_key", 64).primary()
      .references("event_key").inTable("audit_events")
      .onDelete("RESTRICT");
    table.check(hexCheck("event_key", 64));
    configure(table);
  });
}

function createTargetColumns(
  table: Knex.CreateTableBuilder,
  prefix: string
): void {
  table.integer(`${prefix}_kind`).notNullable();
  table.string(`${prefix}_tenant_id`, 64).nullable();
  table.string(`${prefix}_workspace_id`, 64).nullable();
  table.string(`${prefix}_account_principal_id`, 256).nullable();
}

function createBindingColumns(table: Knex.CreateTableBuilder): void {
  table.string("binding_placement_id", 64).notNullable();
  createTargetColumns(table, "binding_target");
  table.string("binding_consumer_id", 64).notNullable();
  table.string("binding_purpose", 64).notNullable();
}

function addBindingChecks(table: Knex.CreateTableBuilder): void {
  table.check(canonicalIdCheck("binding_placement_id", 64));
  table.check(targetCheck("binding_target"));
  table.check(canonicalIdCheck("binding_consumer_id", 64));
  table.check(
    "length(binding_purpose) BETWEEN 1 AND 64 "
    + "AND substr(binding_purpose, 1, 1) GLOB '[a-z]' "
    + "AND binding_purpose NOT GLOB '*[^a-z0-9_]*' "
    + "AND binding_purpose NOT GLOB '*__*' "
    + "AND substr(binding_purpose, -1) <> '_'");
}

function attributionCheck(): string {
  return "(attribution_kind = 1 AND operator_common_name IS NOT NULL "
    + "AND length(operator_common_name) BETWEEN 1 AND 253 "
    + "AND workload_subject IS NULL AND actor_principal_id IS NULL "
    + "AND attached_account_principal_id IS NULL "
    + "AND invocation_workload_subject IS NULL) OR "
    + "(attribution_kind = 2 AND operator_common_name IS NULL "
    + `AND ${workloadSubjectCheck("workload_subject")} `
    + "AND actor_principal_id IS NULL "
    + "AND attached_account_principal_id IS NULL "
    + "AND invocation_workload_subject IS NULL) OR "
    + "(attribution_kind = 3 AND operator_common_name IS NULL "
    + "AND workload_subject IS NULL "
    + `AND ${principalCheck("actor_principal_id")} `
    + `AND ${accountPrincipalCheck("attached_account_principal_id", false)} `
    + `AND ${workloadSubjectCheck("invocation_workload_subject")})`;
}

function partitionCheck(): string {
  return "(partition_kind = 1 AND partition_tenant_id IS NULL "
    + "AND partition_key = 'global') OR "
    + "(partition_kind = 2 AND partition_tenant_id IS NOT NULL "
    + "AND partition_key = 'tenant:' || partition_tenant_id "
    + `AND ${canonicalIdCheck("partition_tenant_id", 64)})`;
}

function targetCheck(prefix: string): string {
  return `(${prefix}_kind = 1 AND ${prefix}_tenant_id IS NULL `
    + `AND ${prefix}_workspace_id IS NULL `
    + `AND ${prefix}_account_principal_id IS NULL) OR `
    + `(${prefix}_kind = 2 `
    + `AND ${canonicalIdCheck(`${prefix}_tenant_id`, 64)} `
    + `AND ${prefix}_workspace_id IS NULL `
    + `AND ${prefix}_account_principal_id IS NULL) OR `
    + `(${prefix}_kind = 3 `
    + `AND ${canonicalIdCheck(`${prefix}_tenant_id`, 64)} `
    + `AND ${canonicalIdCheck(`${prefix}_workspace_id`, 64)} `
    + `AND ${prefix}_account_principal_id IS NULL) OR `
    + `(${prefix}_kind = 4 `
    + `AND ${canonicalIdCheck(`${prefix}_tenant_id`, 64)} `
    + `AND ${prefix}_workspace_id IS NULL `
    + `AND ${accountPrincipalCheck(
      `${prefix}_account_principal_id`,
      false)})`;
}

function canonicalIdCheck(column: string, maximum: number): string {
  return `length(${column}) BETWEEN 1 AND ${String(maximum)} `
    + `AND substr(${column}, 1, 1) GLOB '[a-z0-9]' `
    + `AND ${column} NOT GLOB '*[^a-z0-9_-]*'`;
}

function packageIdCheck(column: string): string {
  return `length(${column}) BETWEEN 1 AND 128 `
    + `AND substr(${column}, 1, 1) GLOB '[a-z0-9]' `
    + `AND ${column} NOT GLOB '*[^a-z0-9._-]*'`;
}

function principalCheck(column: string): string {
  return `${column} IS NOT NULL AND length(${column}) <= 256 AND (`
    + `${localPrincipalCheck(column, "user:")} OR `
    + `${localPrincipalCheck(column, "service:")} OR `
    + `${localPrincipalCheck(column, "agent:")})`;
}

function accountPrincipalCheck(
  column: string,
  humanOnly: boolean
): string {
  const checks = [localPrincipalCheck(column, "user:")];
  if (!humanOnly) {
    checks.push(localPrincipalCheck(column, "service:"));
  }
  return `${column} IS NOT NULL AND length(${column}) <= 256 `
    + `AND (${checks.join(" OR ")})`;
}

function localPrincipalCheck(column: string, prefix: string): string {
  const start = prefix.length + 1;
  return `(${column} LIKE '${prefix}%' `
    + `AND length(${column}) > ${String(prefix.length)} `
    + `AND substr(${column}, ${String(start)}, 1) GLOB '[a-z0-9]' `
    + `AND substr(${column}, ${String(start)}) `
    + "NOT GLOB '*[^a-z0-9._-]*')";
}

function workloadSubjectCheck(column: string): string {
  return `${column} IS NOT NULL `
    + `AND length(${column}) BETWEEN 25 AND 149 `
    + `AND ${column} LIKE 'system:serviceaccount:%:%'`;
}

function hexCheck(column: string, length: number): string {
  return `length(${column}) = ${String(length)} `
    + `AND ${column} NOT GLOB '*[^a-f0-9]*'`;
}

function mutationRevisionCheck(column: string): string {
  return `(action = 1 AND ${column} = 1) `
    + `OR (action = 2 AND ${column} >= 2)`;
}
