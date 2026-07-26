import {
  mkdir,
  chmod,
  mkdtemp
} from "node:fs/promises";
import path from "node:path";
import createKnex from "knex";
import {
  type TestKubernetesStorage
} from "@ctlflow/test-mesh";
import type { TestDatabase } from "./test-database.js";

interface SqliteConnection {
  pragma(statement: string): unknown;
}

type CompleteConnection = (
  error: Error | null,
  connection: SqliteConnection
) => void;

export async function createTestDatabase(
  storage: TestKubernetesStorage
): Promise<TestDatabase> {
  const root = path.join(
    storage.hostRoot,
    "tenantd",
    "databases");
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(
    path.join(root, "database-"));
  await chmod(directory, 0o777);
  const databasePath = path.join(directory, "tenantd.sqlite");

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
    containerPath: "/var/lib/ctlflow/tenantd.sqlite",
    directory,
    storageDirectory: path.relative(storage.hostRoot, directory),
    connection,
    stop: () => connection.destroy()
  };
}
