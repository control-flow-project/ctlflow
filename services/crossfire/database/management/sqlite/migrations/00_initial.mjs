import schema from '../schema.json' with { type: 'json' };
import { executeSql, verifyRelationships } from './assets/sqlite.mjs';

export async function up(knex) {
  for (const part of schema.initialization) await executeSql(knex, schema.parts[part]);
  for (const [table, rows] of Object.entries(schema.reference)) await knex(table).insert(rows);
  await verifyRelationships(knex);
  await knex.raw('PRAGMA application_id=1129465426');
  await knex.raw('PRAGMA user_version=1');
}

export async function down() {
  throw new Error('Database removal requires an explicit reset operation');
}
