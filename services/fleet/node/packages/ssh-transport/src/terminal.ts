import { validateHost } from './host.js';

export function quote(value: string): string { return "'" + value.replaceAll("'", "'\\''") + "'"; }

export function sshTerminalCommand(host: string, command: string): string {
  validateHost(host);
  return ['ssh', '-t', '-o', 'StrictHostKeyChecking=yes', host, command].map(quote).join(' ');
}
