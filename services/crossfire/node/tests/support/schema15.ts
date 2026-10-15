import { openTestStore, statisticsSchema } from './storage.js';
import { restoreSchema16Logging } from './schema16.js';

export function schema15Store(file = ':memory:') {
  const database = openTestStore(file);
  restoreSchema16Logging(database);
  database.exec('DROP TABLE listener_stat_usage; DROP TABLE runtime_usage_checkpoint;');
  const start = statisticsSchema.indexOf('CREATE TABLE listener_stat_usage');
  database.exec(statisticsSchema.slice(start).replace('reasoning_output INTEGER CHECK', 'reasoning_output INTEGER NOT NULL CHECK').replace('reasoning_output INTEGER,', 'reasoning_output INTEGER NOT NULL,'));
  database.pragma('user_version=15');
  database.exec("INSERT INTO principal VALUES('owner','@owner:test','human','active',0,1),('retained-agent','@agent:test','agent','active',0,1); INSERT INTO member VALUES('owner','human','Owner'); INSERT INTO agent VALUES('retained-agent','agent','owner','selected');");
  database.pragma('foreign_keys=ON');
  database.exec("INSERT INTO runtime_usage_checkpoint VALUES('retained-agent','codex','original-history',100,20,NULL,30,10,130,1)");
  return database;
}
