import {
  chmod,
  mkdir,
  mkdtemp
} from "node:fs/promises";
import path from "node:path";
import createKnex from "knex";
import type {
  TestKubernetesStorage
} from "@ctlflow/test-mesh";
import type {
  AuditTestDatabase
} from "./audit-test-database.js";

interface SqliteConnection {
  pragma(statement: string): unknown;
}

type CompleteConnection = (
  error: Error | null,
  connection: SqliteConnection
) => void;

export async function createAuditTestDatabase(
  storage: TestKubernetesStorage
): Promise<AuditTestDatabase> {
  const root = path.join(
    storage.hostRoot,
    "auditd",
    "dependencies");
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(
    path.join(root, "database-"));
  await chmod(directory, 0o777);
  const connection = createKnex({
    client: "better-sqlite3",
    connection: {
      filename: path.join(directory, "auditd.sqlite")
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
        database.pragma("busy_timeout = 5000");
        done(null, database);
      }
    }
  });

  return {
    directory,
    storageDirectory: path.relative(storage.hostRoot, directory),
    connection,
    stop: () => connection.destroy()
  };
}
