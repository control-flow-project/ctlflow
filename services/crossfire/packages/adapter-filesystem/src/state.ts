import { existsSync, unlinkSync } from 'node:fs';
import type { LocalState } from '@ctlflow/crossfire-agent-core/port';
import { readJson, writeJson } from './index.js';
export const localState: LocalState = { exists: existsSync, read: readJson, write: writeJson, remove: unlinkSync };
