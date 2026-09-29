import Database from "better-sqlite3";
import { createSchema } from "@tinqerjs/tinqer";
import { closeSync, existsSync, lstatSync, openSync } from "node:fs";
import { dirname } from "node:path";
import { AGENT_INSTRUCTIONS_MAX_BYTES, type MemberView, type Policy, type Role, type Status } from "../../../../packages/contracts/src/management.js";
import { privateDir } from "../../../../packages/files/src/index.js";
import type { WakePolicy } from '../../../../packages/contracts/src/wake.js';

export type Tables = {
  members: MemberView & { created: number };
  agents: {
    wakePolicy: WakePolicy;
    id: string; owner: string; userId: string; name: string; override: string | null;
    status: Status; revision: number; grantRevision: number; grants: string; applied: string; password: string;
    token: string | null; appliedRevision: number | null; appliedGrantRevision: number | null;
    lastSuccess: number | null; error: string | null; created: number;
  };
  enrollments: {
    id: string; owner: string; name: string; code: string; secretHash: string;
    status: "pending" | "approved" | "rejected"; expires: number; agent: string | null;
  };
  invitations: {
    id: string; secretHash: string; role: Role; expires: number; used: string | null; created: number; revoked: number;
    claimUser: string | null; claimLabel: string | null; claimHash: string | null;
  };
  sessions: { hash: string; member: string; csrf: string; token: string; expires: number };
  listeners: { id: string; agent: string; release: string | null; started: number; lastSeen: number; activeMs: number; messages: number; stopped: number; disconnect: number };
  policy: Policy & { id: string };
  audit: { id: number; actor: string; owner: string; target: string; action: string; detail: string; created: number };
};

export const schema = createSchema<Tables>();
export type Store = Database.Database;
const instructionsColumn = `agentInstructions TEXT NOT NULL DEFAULT '' CHECK(length(CAST(agentInstructions AS BLOB)) <= ${AGENT_INSTRUCTIONS_MAX_BYTES})`;
const wakeColumn = "wakePolicy TEXT NOT NULL DEFAULT 'owner' CHECK(wakePolicy IN ('owner','owner-agents','humans','everyone'))";

export function openStore(path: string): Store {
  if (path !== ":memory:") {
    privateDir(dirname(path));
    if (!existsSync(path)) closeSync(openSync(path, "wx", 0o600));
    const info = lstatSync(path);
    if (!info.isFile() || info.isSymbolicLink() || info.uid !== process.getuid!() || (info.mode & 0o077) !== 0) {
      throw new Error("Management storage must be a private, owned regular file");
    }
  }
  const database = new Database(path);
  database.pragma("foreign_keys = ON");
  database.pragma("busy_timeout = 5000");
  database.pragma("journal_mode = DELETE");
  const pageSize = database.pragma("page_size", { simple: true });
  if (typeof pageSize !== "number" || pageSize < 512 || pageSize > 65536) throw new Error("Invalid SQLite page size");
  database.pragma("max_page_count = " + Math.floor(256 * 1024 * 1024 / pageSize));
  database.exec(`
    CREATE TABLE IF NOT EXISTS members (
      id TEXT PRIMARY KEY, label TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('member','administrator')),
      status TEXT NOT NULL CHECK(status IN ('active','suspended','revoked')),
      revision INTEGER NOT NULL CHECK(revision >= 0), created INTEGER NOT NULL,
      appliedStatus TEXT CHECK(appliedStatus IN ('active','suspended','revoked')), appliedRevision INTEGER,
      lastSuccess INTEGER, error TEXT
    ) STRICT;
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES members(id), userId TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL, override TEXT, ${wakeColumn},
      status TEXT NOT NULL CHECK(status IN ('active','suspended','revoked')),
      revision INTEGER NOT NULL CHECK(revision >= 0), grantRevision INTEGER NOT NULL CHECK(grantRevision >= 0),
      grants TEXT NOT NULL CHECK(json_valid(grants)),
      applied TEXT NOT NULL CHECK(json_valid(applied)), password TEXT NOT NULL, token TEXT,
      appliedRevision INTEGER, appliedGrantRevision INTEGER, lastSuccess INTEGER, error TEXT, created INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS enrollments (
      id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES members(id), name TEXT NOT NULL,
      code TEXT NOT NULL UNIQUE, secretHash TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')),
      expires INTEGER NOT NULL, agent TEXT UNIQUE REFERENCES agents(id)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS invitations (
      id TEXT PRIMARY KEY, secretHash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('member','administrator')),
      expires INTEGER NOT NULL, used TEXT REFERENCES members(id), created INTEGER NOT NULL,
      revoked INTEGER NOT NULL CHECK(revoked IN (0,1)), claimUser TEXT UNIQUE, claimLabel TEXT, claimHash TEXT,
      CHECK((claimUser IS NULL AND claimLabel IS NULL AND claimHash IS NULL)
        OR (claimUser IS NOT NULL AND claimLabel IS NOT NULL AND claimHash IS NOT NULL))
    ) STRICT;
    CREATE TABLE IF NOT EXISTS sessions (
      hash TEXT PRIMARY KEY, member TEXT NOT NULL REFERENCES members(id), csrf TEXT NOT NULL,
      token TEXT NOT NULL, expires INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS listeners (
      id TEXT PRIMARY KEY, agent TEXT NOT NULL REFERENCES agents(id),
      release TEXT,
      started INTEGER NOT NULL, lastSeen INTEGER NOT NULL,
      activeMs INTEGER NOT NULL CHECK(activeMs >= 0), messages INTEGER NOT NULL CHECK(messages >= 0),
      stopped INTEGER NOT NULL CHECK(stopped IN (0,1)), disconnect INTEGER NOT NULL CHECK(disconnect IN (0,1))
    ) STRICT;
    CREATE INDEX IF NOT EXISTS listeners_agent ON listeners(agent, lastSeen);
    CREATE TABLE IF NOT EXISTS policy (
      id TEXT PRIMARY KEY CHECK(id = 'instance'), revision INTEGER NOT NULL CHECK(revision >= 0),
      maxOwnerAgents INTEGER NOT NULL CHECK(maxOwnerAgents BETWEEN 1 AND 100),
      maxAgents INTEGER NOT NULL CHECK(maxAgents BETWEEN maxOwnerAgents AND 1000),
      maxPending INTEGER NOT NULL CHECK(maxPending BETWEEN 1 AND 1000),
      enrollmentSeconds INTEGER NOT NULL CHECK(enrollmentSeconds BETWEEN 60 AND 3600),
      reconcileSeconds INTEGER NOT NULL CHECK(reconcileSeconds BETWEEN 30 AND 3600),
      ${instructionsColumn}
    ) STRICT;
    CREATE TABLE IF NOT EXISTS audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT NOT NULL, owner TEXT NOT NULL, target TEXT NOT NULL, action TEXT NOT NULL,
      detail TEXT NOT NULL CHECK(json_valid(detail)), created INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS agents_owner ON agents(owner);
    CREATE INDEX IF NOT EXISTS enrollments_owner ON enrollments(owner, expires);
    CREATE INDEX IF NOT EXISTS audit_actor ON audit(actor, created, id);
  `);
  for (const addition of [
    { table: 'listeners', name: 'release', declaration: 'release TEXT' },
    { table: 'policy', name: 'agentInstructions', declaration: instructionsColumn },
    { table: 'agents', name: 'wakePolicy', declaration: wakeColumn },
  ]) {
    const columns: unknown = database.pragma('table_info(' + addition.table + ')');
    if (!Array.isArray(columns)) throw new Error('Cannot inspect ' + addition.table + ' schema');
    if (!columns.some(column => column !== null && typeof column === 'object' && 'name' in column && column.name === addition.name)) {
      database.exec('ALTER TABLE ' + addition.table + ' ADD COLUMN ' + addition.declaration);
    }
  }
  return database;
}
