import type { Knex } from "knex";

export interface TenantdTestDatabase {
  readonly path: string;
  readonly containerPath: string;
  readonly directory: string;
  readonly storageDirectory: string;
  readonly connection: Knex;
  readonly stop: () => Promise<void>;
}
