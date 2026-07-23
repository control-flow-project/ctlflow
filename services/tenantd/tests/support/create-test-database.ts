import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import createKnex from "knex";
import { runCommand } from "@ctlflow/test-mesh";
import type { TestDatabase } from "./test-database.js";
import { repositoryRoot } from "./test-paths.js";

interface SqliteConnection {
  pragma(statement: string): unknown;
}

type CompleteConnection = (
  error: Error | null,
  connection: SqliteConnection
) => void;

export async function createTestDatabase(): Promise<TestDatabase> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "ctlflow-tenantd-database-"));
  const databasePath = path.join(directory, "tenantd.sqlite");

  await runCommand(
    "npm",
    ["run", "migrate", "--workspace", "@ctlflow/tenantd"],
    {
      cwd: repositoryRoot,
      environment: {
        CTLFLOW_DATABASE_PATH: databasePath
      }
    });

  const connection = createKnex({
    client: "better-sqlite3",
    connection: {
      filename: databasePath
    },
    useNullAsDefault: true,
    pool: {
      min: 1,
      max: 1,
      afterCreate(
        database: SqliteConnection,
        done: CompleteConnection
      ) {
        database.pragma("foreign_keys = ON");
        done(null, database);
      }
    }
  });

  return {
    path: databasePath,
    connection,
    stop: async () => {
      await connection.destroy();
      await rm(directory, { recursive: true, force: true });
    }
  };
}
