import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { instructionCapability } from '@ctlflow/crossfire-adapter-codex/capability';
import { ownedQuestionCapability, ownedVersion } from '@ctlflow/crossfire-adapter-codex/owned-options';
import { piVersion } from '@ctlflow/crossfire-adapter-pi/options';

const directory = mkdtempSync(join(tmpdir(), 'fleet-native-capability-'));
const command = (binary, arguments_) => execFileSync(binary, arguments_, { encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 }).trim();
try {
  command('codex', ['app-server', 'generate-json-schema', '--out', directory, '--experimental']);
  const results = [
    instructionCapability(JSON.parse(readFileSync(join(directory, 'ClientRequest.json'), 'utf8'))),
    ownedVersion(command('codex', ['--version'])),
    ownedQuestionCapability(command('codex', ['features', 'list'])),
    piVersion(command('pi', ['--version'])),
  ];
  for (const result of results) if (!result.ok) throw new Error(result.error.message);
} finally { rmSync(directory, { recursive: true, force: true }); }
