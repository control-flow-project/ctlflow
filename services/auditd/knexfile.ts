import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Knex } from "knex";

const serviceDirectory = path.dirname(fileURLToPath(import.meta.url));
const databasePath = process.env.CTLFLOW_DATABASE_PATH;

interface SqliteConnection {
  pragma(statement: string): unknown;
}

type CompleteConnection = (
  error: Error | null,
  connection: SqliteConnection
) => void;

if (databasePath === undefined || !path.isAbsolute(databasePath)) {
  throw new Error("CTLFLOW_DATABASE_PATH must be an absolute file path");
}

const configuration = {
  client: "better-sqlite3",
  connection: {
    filename: databasePath
  },
  useNullAsDefault: true,
  pool: {
    min: 1,
    max: 1,
    afterCreate(connection: SqliteConnection, done: CompleteConnection) {
      connection.pragma("foreign_keys = ON");
      connection.pragma("busy_timeout = 5000");
      done(null, connection);
    }
  },
  migrations: {
    directory: path.join(serviceDirectory, "migrations"),
    extension: "js",
    loadExtensions: [".js"],
    tableName: "knex_migrations"
  }
} satisfies Knex.Config;

export default configuration;
