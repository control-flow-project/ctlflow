import schema from './assets/schema-17.json' with { type: 'json' };
import { advanceDeployedSchema } from './assets/deployed-schema.mjs';
import { executeSql, verifyRelationships, version } from './assets/sqlite.mjs';

export async function up(knex) {
  const previous = await version(knex);
  if (previous === 0) {
    for (const part of schema.initialization) await executeSql(knex, schema.parts[part]);
    await knex.raw('CREATE INDEX ix_member_invitation_creator_created ON member_invitation(created_by_member_id, created_at DESC, id)');
  } else if (previous < schema.version) await advanceDeployedSchema(knex, previous, schema);
  await verifyRelationships(knex);
  await knex.raw('PRAGMA application_id=1129465426');
  await knex.raw('PRAGMA user_version=17');
}

export async function down() {
  throw new Error('Production data resets and destructive schema rollback are prohibited; use a reviewed forward migration');
}
