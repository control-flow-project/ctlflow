import { mkdir, mkdtemp } from "node:fs/promises";
import path from "node:path";
import createKnex from "knex";
import { runCommand } from "@ctlflow/test-mesh";
import type { TestDatabase } from "./test-database.js";
import {
  repositoryRoot,
  serviceRoot
} from "./test-paths.js";

interface SqliteConnection {
  pragma(statement: string): unknown;
}

type CompleteConnection = (
  error: Error | null,
  connection: SqliteConnection
) => void;

export async function createTestDatabase(): Promise<TestDatabase> {
  const root = path.join(
    repositoryRoot,
    ".temp",
    "tests",
    "tenantd",
    "databases");
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(
    path.join(root, "database-"));
  const databasePath = path.join(directory, "tenantd.sqlite");

  await runCommand(
    "node",
    [
      path.join(
        serviceRoot,
        ".generated/migrations/tooling/migrations/run.js")
    ],
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
    stop: () => connection.destroy()
  };
}
