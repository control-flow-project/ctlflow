import {
  chmod,
  mkdir,
  mkdtemp
} from "node:fs/promises";
import path from "node:path";
import createKnex, {
  type Knex
} from "knex";
import type {
  TestKubernetesStorage
} from "@ctlflow/test-mesh";

export interface PolicyTestDatabase {
  readonly directory: string;
  readonly storageDirectory: string;
  readonly path: string;
  readonly connection: Knex;
  readonly stop: () => Promise<void>;
}

export async function createPolicyDatabase(
  storage: TestKubernetesStorage
): Promise<PolicyTestDatabase> {
  const root = path.join(
    storage.hostRoot,
    "policyd",
    "dependencies");
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(
    path.join(root, "database-"));
  await chmod(directory, 0o777);
  const databasePath = path.join(directory, "policyd.sqlite");
  const connection = createKnex({
    client: "better-sqlite3",
    connection: {
      filename: databasePath
    },
    useNullAsDefault: true,
    pool: {
      min: 1,
      max: 1,
      afterCreate(database: SqliteConnection, done: CompleteConnection) {
        database.pragma("foreign_keys = ON");
        database.pragma("busy_timeout = 5000");
        done(null, database);
      }
    }
  });

  return {
    directory,
    storageDirectory: path.relative(storage.hostRoot, directory),
    path: databasePath,
    connection,
    stop: () => connection.destroy()
  };
}

interface SqliteConnection {
  pragma(statement: string): unknown;
}

type CompleteConnection = (
  error: Error | null,
  connection: SqliteConnection
) => void;
