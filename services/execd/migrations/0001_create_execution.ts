import type { Knex } from "knex";

const executionIdCheck =
  "length(??) BETWEEN 1 AND 64"
  + " AND ?? GLOB '[a-z0-9]*'"
  + " AND ?? NOT GLOB '*[^a-z0-9_-]*'";
const packageIdCheck =
  "length(??) BETWEEN 1 AND 128"
  + " AND ?? GLOB '[a-z0-9]*'"
  + " AND ?? NOT GLOB '*[^a-z0-9._-]*'";
const lowercaseHex32Glob = "[0-9a-f]".repeat(32);
const serviceAccountSubjectCheck =
  "length(service_account_subject) = 95"
  + " AND service_account_subject GLOB "
  + `'system:serviceaccount:plc-${lowercaseHex32Glob}`
  + `:wld-${lowercaseHex32Glob}'`;

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("placements", (table) => {
    table.string("placement_id", 64).primary();
    table.integer("target_kind").notNullable();
    table.string("tenant_id", 64);
    table.string("workspace_id", 64);
    table.string("account_principal_id", 256);
    table.string("parent_placement_id", 64)
      .references("placement_id").inTable("placements").onDelete("RESTRICT");
    table.integer("desired_state").notNullable();
    table.integer("admit_continuous").notNullable();
    table.integer("admit_finite").notNullable();
    table.integer("max_replicas").notNullable();
    table.bigInteger("max_run_duration_seconds").notNullable();
    table.integer("max_run_attempts").notNullable();
    table.integer("max_cpu_millis").notNullable();
    table.bigInteger("max_memory_bytes").notNullable();
    table.bigInteger("max_storage_bytes").notNullable();
    table.bigInteger("revision").notNullable();
    table.bigInteger("status_revision").notNullable();
    table.bigInteger("observed_revision").notNullable();
    table.integer("realization_phase").notNullable();
    table.integer("realization_reason").notNullable();
    table.bigInteger("created_at_unix_ms").notNullable();
    table.bigInteger("updated_at_unix_ms").notNullable();
    table.bigInteger("status_updated_at_unix_ms").notNullable();
    table.index(["target_kind", "tenant_id", "workspace_id", "account_principal_id", "placement_id"],
      "placements_target_page_idx");
    table.index(["parent_placement_id"], "placements_parent_idx");
    table.check(executionIdCheck, ["placement_id", "placement_id", "placement_id"]);
    table.check("target_kind BETWEEN 1 AND 4");
    table.check(
      "(target_kind = 1 AND tenant_id IS NULL AND workspace_id IS NULL"
      + " AND account_principal_id IS NULL AND parent_placement_id IS NULL)"
      + " OR (target_kind = 2 AND tenant_id IS NOT NULL"
      + " AND workspace_id IS NULL AND account_principal_id IS NULL"
      + " AND parent_placement_id IS NOT NULL)"
      + " OR (target_kind = 3 AND tenant_id IS NOT NULL"
      + " AND workspace_id IS NOT NULL AND account_principal_id IS NULL"
      + " AND parent_placement_id IS NOT NULL)"
      + " OR (target_kind = 4 AND tenant_id IS NOT NULL"
      + " AND workspace_id IS NULL AND account_principal_id IS NOT NULL"
      + " AND parent_placement_id IS NOT NULL)");
    table.check("desired_state BETWEEN 1 AND 3");
    table.check("admit_continuous IN (0, 1)");
    table.check("admit_finite IN (0, 1)");
    table.check("admit_continuous = 1 OR admit_finite = 1");
    table.check("max_replicas BETWEEN 1 AND 100");
    table.check("max_run_duration_seconds BETWEEN 1 AND 604800");
    table.check("max_run_attempts BETWEEN 1 AND 10");
    table.check("max_cpu_millis BETWEEN 1 AND 1000000");
    table.check("max_memory_bytes BETWEEN 1 AND 1099511627776");
    table.check("max_storage_bytes BETWEEN 1 AND 1125899906842624");
    table.check("revision > 0 AND status_revision > 0 AND observed_revision >= 0");
    table.check("realization_phase BETWEEN 1 AND 5");
    table.check("realization_reason BETWEEN 1 AND 8");
    table.check("created_at_unix_ms > 0");
    table.check("updated_at_unix_ms >= created_at_unix_ms");
    table.check("status_updated_at_unix_ms >= created_at_unix_ms");
  });

  await knex.schema.createTable("placement_provisioners", (table) => {
    table.string("placement_id", 64).notNullable()
      .references("placement_id").inTable("placements").onDelete("CASCADE");
    table.string("dependency_type", 128).notNullable();
    table.string("provisioner_id", 64).notNullable();
    table.primary(["placement_id", "dependency_type"]);
    table.check("length(dependency_type) BETWEEN 1 AND 128");
    table.check(executionIdCheck, ["provisioner_id", "provisioner_id", "provisioner_id"]);
  });

  await knex.schema.createTable("workloads", (table) => {
    table.string("workload_id", 64).primary();
    table.string("placement_id", 64).notNullable()
      .references("placement_id").inTable("placements").onDelete("RESTRICT");
    table.integer("desired_state").notNullable();
    table.integer("mode").notNullable();
    table.string("app_id", 64).notNullable();
    table.bigInteger("app_revision").notNullable();
    table.string("package_id", 128).notNullable();
    table.bigInteger("package_generation").notNullable();
    table.string("component_id", 64).notNullable();
    // Derived by Execd in the admission transaction and never supplied by a
    // caller. Unique so Policyd can resolve a subject to exactly one Workload.
    table.string("service_account_subject", 512).notNullable();
    table.string("artifact_repository", 255).notNullable();
    table.string("artifact_manifest_digest", 71).notNullable();
    table.integer("cpu_millis").notNullable();
    table.bigInteger("memory_bytes").notNullable();
    table.integer("replicas");
    table.string("actor_principal_id", 256);
    table.bigInteger("run_duration_seconds");
    table.integer("max_attempts");
    table.bigInteger("revision").notNullable();
    table.bigInteger("status_revision").notNullable();
    table.bigInteger("observed_revision").notNullable();
    table.integer("realization_phase").notNullable();
    table.integer("realization_reason").notNullable();
    table.bigInteger("created_at_unix_ms").notNullable();
    table.bigInteger("updated_at_unix_ms").notNullable();
    table.bigInteger("status_updated_at_unix_ms").notNullable();
    table.index(["placement_id", "workload_id"], "workloads_placement_page_idx");
    table.unique(["service_account_subject"], {
      indexName: "workloads_service_account_subject_unique_idx"
    });
    table.check(serviceAccountSubjectCheck);
    table.check(executionIdCheck, ["workload_id", "workload_id", "workload_id"]);
    table.check(executionIdCheck, ["app_id", "app_id", "app_id"]);
    table.check(packageIdCheck, ["package_id", "package_id", "package_id"]);
    table.check(executionIdCheck, ["component_id", "component_id", "component_id"]);
    table.check("desired_state BETWEEN 1 AND 3");
    table.check("mode BETWEEN 1 AND 2");
    table.check("app_revision > 0 AND package_generation > 0");
    table.check("cpu_millis BETWEEN 1 AND 1000000");
    table.check("memory_bytes BETWEEN 1 AND 1099511627776");
    table.check(
      "(mode = 1 AND replicas BETWEEN 1 AND 100"
      + " AND actor_principal_id IS NULL"
      + " AND run_duration_seconds IS NULL AND max_attempts IS NULL)"
      + " OR (mode = 2 AND replicas IS NULL"
      + " AND run_duration_seconds BETWEEN 1 AND 604800"
      + " AND max_attempts BETWEEN 1 AND 10)");
    table.check("revision > 0 AND status_revision > 0 AND observed_revision >= 0");
    table.check("realization_phase BETWEEN 1 AND 5");
    table.check("realization_reason BETWEEN 1 AND 8");
  });

  await createConfigTargets(knex, "workload_config_targets", "workload_id", "workloads");

  await knex.schema.createTable("workload_dependencies", (table) => {
    table.string("workload_id", 64).notNullable()
      .references("workload_id").inTable("workloads").onDelete("CASCADE");
    table.string("component_id", 64).notNullable();
    table.string("dependency_name", 200).notNullable();
    table.string("dependency_id", 64);
    table.string("dependency_type", 128).notNullable();
    table.binary("options_json").notNullable();
    table.integer("options_length").notNullable();
    table.string("options_sha256", 64).notNullable();
    table.string("provisioner_id", 64).notNullable();
    table.string("provisioner_subject", 256).notNullable();
    table.string("claim_id", 36).notNullable();
    table.bigInteger("claim_revision").notNullable();
    table.string("binding_id", 128);
    table.bigInteger("binding_revision");
    table.bigInteger("observed_claim_revision").notNullable();
    table.integer("binding_phase").notNullable();
    table.primary(["workload_id", "component_id", "dependency_name"]);
    table.unique(["claim_id"]);
    table.check(executionIdCheck, ["component_id", "component_id", "component_id"]);
    table.check("length(dependency_name) BETWEEN 1 AND 200");
    table.check("dependency_id IS NULL OR length(dependency_id) BETWEEN 1 AND 64");
    table.check("length(dependency_type) BETWEEN 1 AND 128");
    table.check("options_length BETWEEN 2 AND 65536");
    table.check("length(options_sha256) = 64 AND options_sha256 NOT GLOB '*[^0-9a-f]*'");
    table.check(executionIdCheck, ["provisioner_id", "provisioner_id", "provisioner_id"]);
    table.check(
      "provisioner_subject GLOB 'system:serviceaccount:*:*'"
      + " AND length(provisioner_subject) BETWEEN 25 AND 256");
    table.check("claim_id GLOB 'dpc-[0-9a-f]*' AND length(claim_id) = 36");
    table.check("claim_revision > 0 AND observed_claim_revision >= 0");
    table.check("binding_phase BETWEEN 1 AND 3");
    table.check(
      "(binding_phase = 2 AND binding_id IS NOT NULL AND binding_revision > 0)"
      + " OR (binding_phase != 2 AND binding_id IS NULL AND binding_revision IS NULL)");
  });

  await createDependencyParameters(
    knex,
    "workload_dependency_parameters",
    "workload_dependencies");
  await createDependencyOutputs(
    knex,
    "workload_dependency_outputs",
    "workload_dependencies");
  await knex.schema.createTable("app_storage_bindings", (table) => {
    table.string("placement_id", 64).notNullable()
      .references("placement_id").inTable("placements").onDelete("RESTRICT");
    table.string("app_id", 64).notNullable();
    table.string("storage_id", 64).notNullable();
    table.bigInteger("capacity_bytes").notNullable();
    table.primary(["placement_id", "app_id", "storage_id"]);
    table.check(executionIdCheck, ["app_id", "app_id", "app_id"]);
    table.check(executionIdCheck, ["storage_id", "storage_id", "storage_id"]);
    table.check("capacity_bytes BETWEEN 1 AND 1125899906842624");
  });
  await createStorage(knex, "workload_storage", "workload_id", "workloads");

  // Operations admitted for this Workload, snapshotted from the admitted
  // package component at admission. Authority reflects what was admitted, not a
  // later Pkgd read. Not exposed in the caller-visible Workload projection.
  await knex.schema.createTable("workload_operations", (table) => {
    table.string("workload_id", 64).notNullable()
      .references("workload_id").inTable("workloads").onDelete("RESTRICT");
    table.string("operation", 128).notNullable();
    table.primary(["workload_id", "operation"]);
    table.check("length(operation) BETWEEN 3 AND 128");
    table.check("operation NOT GLOB '*[^a-z0-9_.]*'");
    table.check(
      "length(operation) - length(replace(operation, '.', '')) = 1");
    table.check("operation NOT GLOB '.*'");
    table.check("operation NOT GLOB '*.'");
  });
  await knex.schema.createTable("workload_interfaces", (table) => {
    table.string("workload_id", 64).notNullable()
      .references("workload_id").inTable("workloads").onDelete("CASCADE");
    table.string("interface_id", 64).notNullable();
    table.integer("protocol").notNullable();
    table.string("contract_id", 128).notNullable();
    table.integer("port").notNullable();
    table.string("exposure_id", 64);
    table.string("endpoint_host", 253);
    table.integer("ready").notNullable();
    table.primary(["workload_id", "interface_id"]);
    table.check(executionIdCheck, ["interface_id", "interface_id", "interface_id"]);
    table.check("protocol BETWEEN 1 AND 2");
    table.check("length(contract_id) BETWEEN 1 AND 128");
    table.check("port BETWEEN 1 AND 65535");
    table.check("exposure_id IS NULL OR length(exposure_id) BETWEEN 1 AND 64");
    table.check("endpoint_host IS NULL OR length(endpoint_host) BETWEEN 1 AND 253");
    table.check("ready IN (0, 1)");
  });

  await knex.schema.createTable("runs", (table) => {
    table.string("run_id", 128).primary();
    table.string("workload_id", 64).notNullable()
      .references("workload_id").inTable("workloads").onDelete("RESTRICT");
    table.bigInteger("workload_revision").notNullable();
    table.string("placement_id", 64).notNullable()
      .references("placement_id").inTable("placements").onDelete("RESTRICT");
    table.integer("target_kind").notNullable();
    table.string("tenant_id", 64);
    table.string("workspace_id", 64);
    table.string("account_principal_id", 256);
    table.string("actor_principal_id", 256);
    table.string("app_id", 64).notNullable();
    table.bigInteger("app_revision").notNullable();
    table.string("package_id", 128).notNullable();
    table.bigInteger("package_generation").notNullable();
    table.string("component_id", 64).notNullable();
    table.string("artifact_repository", 255).notNullable();
    table.string("artifact_manifest_digest", 71).notNullable();
    table.integer("cpu_millis").notNullable();
    table.bigInteger("memory_bytes").notNullable();
    table.bigInteger("run_duration_seconds").notNullable();
    table.integer("max_attempts").notNullable();
    table.integer("phase").notNullable();
    table.integer("reason").notNullable();
    table.integer("attempt_count").notNullable();
    table.bigInteger("revision").notNullable();
    table.bigInteger("created_at_unix_ms").notNullable();
    table.bigInteger("started_at_unix_ms");
    table.bigInteger("updated_at_unix_ms").notNullable();
    table.bigInteger("completed_at_unix_ms");
    table.index(["workload_id", "run_id"], "runs_workload_page_idx");
    table.index(["placement_id"], "runs_placement_idx");
    table.index(["phase", "run_id"], "runs_reconcile_idx");
    table.check(
      "length(run_id) BETWEEN 1 AND 128"
      + " AND run_id GLOB '[a-z0-9]*'"
      + " AND run_id NOT GLOB '*[^a-z0-9._-]*'");
    table.check("workload_revision > 0 AND app_revision > 0 AND package_generation > 0");
    table.check("target_kind BETWEEN 1 AND 4");
    table.check("run_duration_seconds BETWEEN 1 AND 604800");
    table.check("max_attempts BETWEEN 1 AND 10");
    table.check("phase BETWEEN 1 AND 7");
    table.check("reason BETWEEN 1 AND 12");
    table.check("attempt_count BETWEEN 0 AND max_attempts");
    table.check("revision > 0 AND created_at_unix_ms > 0");
    table.check("updated_at_unix_ms >= created_at_unix_ms");
    table.check("started_at_unix_ms IS NULL OR started_at_unix_ms >= created_at_unix_ms");
    table.check("completed_at_unix_ms IS NULL OR completed_at_unix_ms >= created_at_unix_ms");
  });

  await createConfigTargets(knex, "run_config_targets", "run_id", "runs", 128);
  await knex.schema.createTable("run_dependencies", (table) => {
    table.string("run_id", 128).notNullable()
      .references("run_id").inTable("runs").onDelete("CASCADE");
    table.string("component_id", 64).notNullable();
    table.string("dependency_name", 200).notNullable();
    table.string("dependency_id", 64);
    table.string("dependency_type", 128).notNullable();
    table.binary("options_json").notNullable();
    table.integer("options_length").notNullable();
    table.string("options_sha256", 64).notNullable();
    table.string("provisioner_id", 64).notNullable();
    table.string("provisioner_subject", 256).notNullable();
    table.string("claim_id", 36).notNullable();
    table.bigInteger("claim_revision").notNullable();
    table.string("binding_id", 128);
    table.bigInteger("binding_revision");
    table.bigInteger("observed_claim_revision").notNullable();
    table.integer("binding_phase").notNullable();
    table.primary(["run_id", "component_id", "dependency_name"]);
    table.check("claim_revision > 0 AND observed_claim_revision >= 0");
    table.check("binding_phase BETWEEN 1 AND 3");
    table.check(
      "(binding_phase = 2 AND binding_id IS NOT NULL AND binding_revision > 0)"
      + " OR (binding_phase != 2 AND binding_id IS NULL AND binding_revision IS NULL)");
  });
  await createRunDependencyParameters(knex);
  await createRunDependencyOutputs(knex);
  await createStorage(knex, "run_storage", "run_id", "runs", 128);
}

async function createConfigTargets(
  knex: Knex,
  tableName: string,
  ownerColumn: string,
  ownerTable: string,
  ownerLength = 64
): Promise<void> {
  await knex.schema.createTable(tableName, (table) => {
    table.string(ownerColumn, ownerLength).notNullable()
      .references(ownerColumn).inTable(ownerTable).onDelete("CASCADE");
    table.integer("data_kind").notNullable();
    table.string("purpose", 64).notNullable();
    table.string("target_id", 64).notNullable();
    table.string("target_version_id", 64).notNullable();
    table.string("projection_id", 56);
    table.bigInteger("projection_revision");
    table.primary([ownerColumn, "data_kind", "purpose"]);
    table.check("data_kind BETWEEN 1 AND 2");
    table.check("length(purpose) BETWEEN 1 AND 64");
    table.check("length(target_id) BETWEEN 1 AND 64");
    table.check("length(target_version_id) BETWEEN 1 AND 64");
    table.check(
      "(projection_id IS NULL AND projection_revision IS NULL)"
      + " OR (projection_id GLOB 'prj_[a-z2-7]*'"
      + " AND length(projection_id) = 56 AND projection_revision > 0)");
  });
}

async function createDependencyParameters(
  knex: Knex,
  tableName: string,
  dependencyTable: string
): Promise<void> {
  await knex.schema.createTable(tableName, (table) => {
    table.string("workload_id", 64).notNullable();
    table.string("component_id", 64).notNullable();
    table.string("dependency_name", 200).notNullable();
    table.string("parameter_name", 64).notNullable();
    table.integer("data_kind").notNullable();
    table.string("purpose", 64).notNullable();
    table.string("target_id", 64).notNullable();
    table.string("target_version_id", 64).notNullable();
    table.string("projection_id", 56);
    table.bigInteger("projection_revision");
    table.primary(["workload_id", "component_id", "dependency_name", "parameter_name"]);
    table.foreign(
      ["workload_id", "component_id", "dependency_name"],
      `${tableName}_dependency_fk`)
      .references(["workload_id", "component_id", "dependency_name"])
      .inTable(dependencyTable).onDelete("CASCADE");
    table.check(executionIdCheck, ["parameter_name", "parameter_name", "parameter_name"]);
    table.check("data_kind BETWEEN 1 AND 2");
    table.check(
      "(projection_id IS NULL AND projection_revision IS NULL)"
      + " OR (projection_id GLOB 'prj_[a-z2-7]*'"
      + " AND length(projection_id) = 56 AND projection_revision > 0)");
  });
}

async function createDependencyOutputs(
  knex: Knex,
  tableName: string,
  dependencyTable: string
): Promise<void> {
  await knex.schema.createTable(tableName, (table) => {
    table.string("workload_id", 64).notNullable();
    table.string("component_id", 64).notNullable();
    table.string("dependency_name", 200).notNullable();
    table.integer("data_kind").notNullable();
    table.string("purpose", 64).notNullable();
    table.string("target_id", 64).notNullable();
    table.string("target_version_id", 64).notNullable();
    table.string("projection_id", 56);
    table.bigInteger("projection_revision");
    table.primary(["workload_id", "component_id", "dependency_name", "data_kind", "purpose"]);
    table.foreign(
      ["workload_id", "component_id", "dependency_name"],
      `${tableName}_dependency_fk`)
      .references(["workload_id", "component_id", "dependency_name"])
      .inTable(dependencyTable).onDelete("CASCADE");
    table.check("data_kind BETWEEN 1 AND 2");
  });
}

async function createStorage(
  knex: Knex,
  tableName: string,
  ownerColumn: string,
  ownerTable: string,
  ownerLength = 64
): Promise<void> {
  await knex.schema.createTable(tableName, (table) => {
    table.string(ownerColumn, ownerLength).notNullable()
      .references(ownerColumn).inTable(ownerTable).onDelete("CASCADE");
    table.string("placement_id", 64).notNullable();
    table.string("app_id", 64).notNullable();
    table.string("storage_id", 64).notNullable();
    table.string("mount_path", 256).notNullable();
    table.primary([ownerColumn, "storage_id"]);
    table.unique([ownerColumn, "mount_path"]);
    table.index(
      ["placement_id", "app_id", "storage_id"],
      `${tableName}_app_storage_binding_idx`);
    table.foreign(
      ["placement_id", "app_id", "storage_id"],
      `${tableName}_app_storage_binding_fk`)
      .references(["placement_id", "app_id", "storage_id"])
      .inTable("app_storage_bindings").onDelete("RESTRICT");
    table.check(executionIdCheck, ["placement_id", "placement_id", "placement_id"]);
    table.check(executionIdCheck, ["app_id", "app_id", "app_id"]);
    table.check(executionIdCheck, ["storage_id", "storage_id", "storage_id"]);
    table.check("length(mount_path) BETWEEN 2 AND 256 AND substr(mount_path, 1, 1) = '/'");
  });
}

async function createRunDependencyParameters(knex: Knex): Promise<void> {
  await knex.schema.createTable("run_dependency_parameters", (table) => {
    table.string("run_id", 128).notNullable();
    table.string("component_id", 64).notNullable();
    table.string("dependency_name", 200).notNullable();
    table.string("parameter_name", 64).notNullable();
    table.integer("data_kind").notNullable();
    table.string("purpose", 64).notNullable();
    table.string("target_id", 64).notNullable();
    table.string("target_version_id", 64).notNullable();
    table.string("projection_id", 56).notNullable();
    table.bigInteger("projection_revision").notNullable();
    table.primary(["run_id", "component_id", "dependency_name", "parameter_name"]);
    table.foreign(
      ["run_id", "component_id", "dependency_name"],
      "run_dependency_parameters_dependency_fk")
      .references(["run_id", "component_id", "dependency_name"])
      .inTable("run_dependencies").onDelete("CASCADE");
  });
}

async function createRunDependencyOutputs(knex: Knex): Promise<void> {
  await knex.schema.createTable("run_dependency_outputs", (table) => {
    table.string("run_id", 128).notNullable();
    table.string("component_id", 64).notNullable();
    table.string("dependency_name", 200).notNullable();
    table.integer("data_kind").notNullable();
    table.string("purpose", 64).notNullable();
    table.string("target_id", 64).notNullable();
    table.string("target_version_id", 64).notNullable();
    table.string("projection_id", 56).notNullable();
    table.bigInteger("projection_revision").notNullable();
    table.primary(["run_id", "component_id", "dependency_name", "data_kind", "purpose"]);
    table.foreign(
      ["run_id", "component_id", "dependency_name"],
      "run_dependency_outputs_dependency_fk")
      .references(["run_id", "component_id", "dependency_name"])
      .inTable("run_dependencies").onDelete("CASCADE");
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("run_dependency_outputs");
  await knex.schema.dropTableIfExists("run_dependency_parameters");
  await knex.schema.dropTableIfExists("run_dependencies");
  await knex.schema.dropTableIfExists("run_storage");
  await knex.schema.dropTableIfExists("run_config_targets");
  await knex.schema.dropTableIfExists("runs");
  await knex.schema.dropTableIfExists("workload_operations");
  await knex.schema.dropTableIfExists("workload_interfaces");
  await knex.schema.dropTableIfExists("workload_storage");
  await knex.schema.dropTableIfExists("app_storage_bindings");
  await knex.schema.dropTableIfExists("workload_dependency_outputs");
  await knex.schema.dropTableIfExists("workload_dependency_parameters");
  await knex.schema.dropTableIfExists("workload_dependencies");
  await knex.schema.dropTableIfExists("workload_config_targets");
  await knex.schema.dropTableIfExists("workloads");
  await knex.schema.dropTableIfExists("placement_provisioners");
  await knex.schema.dropTableIfExists("placements");
}
