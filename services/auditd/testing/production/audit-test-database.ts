import type {
  Knex
} from "knex";

export interface AuditTestDatabase {
  readonly directory: string;
  readonly storageDirectory: string;
  readonly connection: Knex;
  readonly stop: () => Promise<void>;
}
