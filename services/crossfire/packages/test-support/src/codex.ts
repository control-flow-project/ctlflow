import { appendFileSync } from 'node:fs';
import { join } from 'node:path';

export function trustWorkspace(home: string, workspace: string): void {
  appendFileSync(join(home, 'config.toml'), '\n[projects.' + JSON.stringify(workspace) + ']\ntrust_level = "trusted"\n');
}
