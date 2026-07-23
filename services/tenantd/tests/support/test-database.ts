import type { Knex } from "knex";

export interface TestDatabase {
  readonly path: string;
  readonly connection: Knex;
  readonly stop: () => Promise<void>;
}
