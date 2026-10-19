import type { Config } from '../../apps/server/src/config.js';
import { matrixConfiguration } from '@ctlflow/crossfire-adapter-matrix/config';
import { value } from './application.js';

export function matrixSettings(config: Config) {
  return value(matrixConfiguration(config.messaging));
}
