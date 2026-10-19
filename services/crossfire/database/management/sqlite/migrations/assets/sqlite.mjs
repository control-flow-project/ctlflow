export async function executeSql(knex, sql) {
  const connection = await knex.client.acquireConnection();
  try { connection.exec(sql); }
  finally { await knex.client.releaseConnection(connection); }
}

export async function verifyRelationships(knex) {
  if ((await knex('pragma_foreign_key_check').select('*')).length)
    throw new Error('Database initialization violates foreign-key relationships');
}
