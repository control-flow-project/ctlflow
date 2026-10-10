import type Database from 'better-sqlite3';
import { statisticsSchema } from './statistics.js';

export function migrateUsageSchema(database: Database.Database): void {
  database.transaction(() => {
    for (const table of ['listener_stat_usage', 'runtime_usage_checkpoint']) {
      const start = statisticsSchema.indexOf('CREATE TABLE ' + table + ' ('), next = statisticsSchema.indexOf('CREATE TABLE ', start + 1);
      if (start < 0) throw new Error('Missing canonical usage table');
      const definition = statisticsSchema.slice(start, next < 0 ? undefined : next);
      database.exec(definition.replace('CREATE TABLE ' + table, 'CREATE TABLE ' + table + '_next')
        .replaceAll('ON ' + table + '(', 'ON ' + table + '_next(').replace(/CREATE INDEX ([a-z_]+)/gu, 'CREATE INDEX $1_next'));
      database.exec('INSERT INTO ' + table + '_next SELECT * FROM ' + table + '; DROP TABLE ' + table + '; ALTER TABLE ' + table + '_next RENAME TO ' + table + ';');
      for (const index of definition.matchAll(/CREATE INDEX ([a-z_]+)[^;]+;/gu)) {
        database.exec('DROP INDEX ' + index[1] + '_next; ' + index[0]);
      }
    }
    const violations = database.pragma('foreign_key_check');
    if (!Array.isArray(violations) || violations.length) throw new Error('Usage migration would violate preserved relationships');
    database.pragma('user_version = 16');
  }).immediate();
}
