export async function executeSql(knex, sql) {
  const connection = await knex.client.acquireConnection();
  try { connection.exec(sql); }
  finally { await knex.client.releaseConnection(connection); }
}

export async function version(knex) {
  const rows = await knex.raw('PRAGMA user_version');
  return rows[0].user_version;
}

export async function verifyRelationships(knex) {
  if ((await knex.raw('PRAGMA foreign_key_check')).length)
    throw new Error('Migration would violate preserved relationships');
}

export function tableDefinition(schema, table) {
  const start = schema.indexOf('CREATE TABLE ' + table + ' (');
  const end = schema.indexOf('CREATE TABLE ', start + 1);
  if (start < 0) throw new Error('Missing canonical table schema: ' + table);
  return schema.slice(start, end < 0 ? undefined : end).trim();
}

export async function createReplacement(knex, definition) {
  const table = /^CREATE TABLE ([a-z_]+)/u.exec(definition)[1];
  await executeSql(knex, definition.replace('CREATE TABLE ' + table, 'CREATE TABLE ' + table + '_next')
    .replaceAll('ON ' + table + '(', 'ON ' + table + '_next(').replace(/CREATE INDEX ([a-z_]+)/gu, 'CREATE INDEX $1_next'));
}

export async function installReplacement(knex, definition) {
  const table = /^CREATE TABLE ([a-z_]+)/u.exec(definition)[1];
  await executeSql(knex, 'DROP TABLE ' + table + '; ALTER TABLE ' + table + '_next RENAME TO ' + table + ';');
  for (const index of definition.matchAll(/CREATE INDEX ([a-z_]+)[^;]+;/gu))
    await executeSql(knex, 'DROP INDEX ' + index[1] + '_next; ' + index[0]);
}
