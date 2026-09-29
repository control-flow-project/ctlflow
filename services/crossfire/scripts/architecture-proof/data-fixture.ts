import Database from "better-sqlite3";
import { createSchema } from "@tinqerjs/tinqer";
import { executeInsert, executeSelect } from "@tinqerjs/better-sqlite3-adapter";

export type Schema = {
  agents: { id: string; owner: string; name: string; revision: number };
  audit: { id: string; agent: string; action: string };
};

export const schema = createSchema<Schema>();

export function openDatabase(path = ":memory:"): Database.Database {
  const database = new Database(path);
  database.pragma("foreign_keys = ON");
  database.pragma("busy_timeout = 0");
  database.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      name TEXT NOT NULL,
      revision INTEGER NOT NULL CHECK (revision >= 0)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS audit (
      id TEXT PRIMARY KEY,
      agent TEXT NOT NULL REFERENCES agents(id),
      action TEXT NOT NULL
    ) STRICT;
  `);
  return database;
}

export function insertAgent(database: Database.Database, input: Schema["agents"]): void {
  executeInsert(database, schema, (query, params) => query.insertInto("agents").values({
    id: params.id, owner: params.owner, name: params.name, revision: params.revision,
  }), input);
}

export function readOwnerAgents(database: Database.Database, owner: string) {
  return executeSelect(database, schema, (query, params) => query.from("agents")
    .where(agent => agent.owner === params.owner).orderBy(agent => agent.id).take(10), { owner });
}

export function readAgent(database: Database.Database, owner: string, id: string) {
  return executeSelect(database, schema, (query, params) => query.from("agents")
    .where(agent => agent.owner === params.owner && agent.id === params.id).firstOrDefault(), { owner, id });
}
