import type { Settings } from '../skills/conduit-chat/scripts/lib.ts';

export const CLIENT_PATH = '/_coord/client';
export const INSTALLER_PATH = '/_coord/install.mjs';
export type ClientFiles = Record<string, string>;

export function enrollmentUrl(settings: Settings): string {
  // The fragment is read by the installer and sent as an Authorization header,
  // never as part of the HTTP request URL.
  return settings.room_service + CLIENT_PATH + '#' + settings.registration_token;
}

export function bootstrapArguments(settings: Settings): string[] {
  const source = settings.room_service + INSTALLER_PATH;
  const script = `const r=await fetch('${source}',{redirect:'error',signal:AbortSignal.timeout(10000)});`
    + `if(!r.ok)throw Error('Installer unavailable: '+r.status);`
    + `await import('data:text/javascript;base64,'+Buffer.from(await r.text()).toString('base64'))`;
  // The script-name argument makes argv identical to running install.mjs from
  // disk. This works without a checkout, npm, shell utilities, or shared files.
  return ['--input-type=module', '-e', script, 'crossfire-install', enrollmentUrl(settings)];
}

export function onboarding(settings: Settings): string {
  const args = bootstrapArguments(settings);
  const command = `node --input-type=module -e "${args[2]}" crossfire-install "${args[4]}"`;
  return [
    '', 'CLIENT ONBOARDING — copy this block to each agent:',
    `Instance: ${settings.instance}`,
    'Run this command as the local user running the agent (Node.js 22.18+):',
    command,
    '', 'Read the skill_file printed by the installer.',
    `Use instance ${settings.instance} and a unique agent name for each simultaneous session.`,
    'From your project directory, initialize that agent, list rooms, and read messages using the skill.',
    'Installation can be repeated; existing accounts and unread positions are preserved.',
    'This command contains an enrollment credential. Share it only with intended local clients.',
    `Print these instructions again with: node crossfire onboarding ${settings.instance}`,
  ].join('\n');
}
