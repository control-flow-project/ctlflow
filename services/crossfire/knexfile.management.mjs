import { join } from 'node:path';
import { databaseConfiguration } from './database/management/sqlite/configuration.mjs';

const directory = process.env.CROSSFIRE_DATA_DIR;
if (!directory) throw new Error('CROSSFIRE_DATA_DIR is required for management database migrations');
const configuration = databaseConfiguration(join(directory, 'management.sqlite'));
export default { development: configuration, test: configuration, production: configuration };
