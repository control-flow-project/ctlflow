import type Database from 'better-sqlite3';
import type { StatisticsRepository } from '@crossfire/domain/statistics/types';
import { statisticsRecorder } from './record.js';
import { statisticsReader } from './read.js';
export function createStatisticsRepository(database: Database.Database): StatisticsRepository {
  return { record: statisticsRecorder(database), read: statisticsReader(database) };
}
