import { isAbsolute } from 'node:path';
import type { RuntimeTerminalAdapter } from '@crossfire/agent-core/terminal';
import * as check from '@crossfire/contracts/schema/validation';
import { failure, success } from '@crossfire/kernel/result';
import { localEndpoint } from './protocol.js';

function quote(value: string): string { return "'" + value.replaceAll("'", "'\\''") + "'"; }
const connection = check.object({ endpoint: check.text(2048), tokenFile: check.text(4096), home: check.text(4096), binary: check.text(4096), path: check.text(4096) });

export function codexTerminal(): RuntimeTerminalAdapter {
  return { command(attachment) {
    const parsed = connection(attachment.connection);
    if (!parsed.ok) return parsed;
    const { endpoint: remote, tokenFile, home, binary, path } = parsed.value;
    if (attachment.runtime !== 'codex' || !check.identifier(attachment.sessionId).ok || !isAbsolute(attachment.workspace)
      || !isAbsolute(tokenFile) || !isAbsolute(home) || /[\x00-\x1f\x7f]/u.test(attachment.workspace + tokenFile + home)) {
      return failure('invalid', 'Invalid Codex terminal attachment');
    }
    let endpoint: string;
    try { endpoint = localEndpoint(remote); }
    catch { return failure('invalid', 'Invalid Codex terminal endpoint'); }
    const arguments_ = [binary, '--remote', endpoint, '--remote-auth-token-env', 'FLEET_RUNTIME_AUTH_TOKEN',
      '--cd', attachment.workspace, 'resume', attachment.sessionId];
    return success('PATH=' + quote(path) + ' CODEX_HOME=' + quote(home) + ' FLEET_RUNTIME_AUTH_TOKEN="$(cat -- ' + quote(tokenFile) + ')" ' + arguments_.map(quote).join(' '));
  } };
}
