import schema from './assets/schema-17.json' with { type: 'json' };
import { verifyRelationships } from './assets/sqlite.mjs';

export async function up(knex) {
  for (const [table, rows] of Object.entries(schema.reference)) {
    const columns = Object.keys(rows[0]);
    const existing = await knex(table).select(columns);
    if (!existing.length) await knex(table).insert(rows);
    else {
      const key = row => JSON.stringify(columns.map(column => row[column]));
      const actual = new Set(existing.map(key));
      if (actual.size !== rows.length || rows.some(row => !actual.has(key(row))))
        throw new Error('Canonical authorization reference data differs: ' + table);
    }
  }
  await verifyRelationships(knex);
}

export async function down() {
  throw new Error('Authorization reference data cannot be removed; use a reviewed forward migration');
}
