import type { Manifest } from './release.js';

function quote(value: string): string { return "'" + value.replaceAll("'", "'\\''") + "'"; }

export function onboardingUrl(origin: string, owner: string): string {
  return origin + '/_coord/setup?owner=' + encodeURIComponent(owner);
}

export function onboardingGuide(origin: string, owner: string, release: Manifest): string {
  return [
    '# Connect this project to Crossfire',
    '',
    'Server: ' + origin,
    'Owner: ' + owner,
    '',
    'Use this trusted server’s client from the project directory. Requires Linux, Node.js 26+, Git, Bash, curl and sha256sum. Open Codex 0.158.0+ with the current runcodex.sh; the adapter obtains connection details automatically. Never request ports, session IDs, tokens or Matrix passwords.',
    '',
    'Reuse the project identity. Only if none exists, ask for a lowercase name (letters, digits, hyphens) and set CROSSFIRE_AGENT_NAME. If several identities exist, ask which one and set that name. Do not create another identity for reconnects or upgrades.',
    '',
    'Inspect and run this Bash command. It verifies the bootstrap client and installs or updates private, Git-ignored project files. Hashes from this server verify bytes, not independent publisher identity.',
    '',
    '```bash',
    onboardingCommand(origin, owner, release),
    '```',
    '',
    'Read any changed skill returned in command output. If awaiting-approval, give the human the exact URL and code while the command continues waiting. Approval continues connection automatically; do not model-poll or start a separate listener. The owner chooses rooms in management; approval alone grants none.',
    '',
    'Success is a ready listener, not just saved credentials. Later reconnects and upgrades use `node .crossfire/client.mjs agent connect`; no re-enrollment is needed.',
    '',
  ].join('\n');
}

export function onboardingCommand(origin: string, owner: string, release: Manifest): string {
  const client = release.artifacts['crossfire-client.mjs'];
  return [
    'set -eu',
    'umask 077',
    'options=()',
    'if [ -n "${CROSSFIRE_AGENT_NAME:-}" ]; then options=(--profile "$CROSSFIRE_AGENT_NAME"); fi',
    'if [ -L .crossfire/client.mjs ]; then',
    '  client="$PWD/.crossfire/client.mjs"',
    'else',
    '  temporary=$(mktemp -d)',
    '  trap \'rm -f -- "$temporary/crossfire-client.mjs"; rmdir -- "$temporary"\' EXIT',
    '  client="$temporary/crossfire-client.mjs"',
    '  curl --fail --silent --show-error --max-time 30 --max-filesize ' + client.bytes + ' --output "$client" ' + quote(origin + '/onboarding/' + release.release + '/crossfire-client.mjs'),
    '  test "$(wc -c < "$client")" -eq ' + client.bytes,
    '  printf \'%s  %s\\n\' ' + quote(client.sha256) + ' "$client" | sha256sum --check --status',
    'fi',
    'node "$client" --project "$PWD" "${options[@]}" agent connect --server ' + quote(origin) + ' --owner ' + quote(owner),
  ].join('\n');
}
