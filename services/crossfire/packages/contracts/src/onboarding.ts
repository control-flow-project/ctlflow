import type { Manifest } from './release.js';

function quote(value: string): string { return "'" + value.replaceAll("'", "'\\''") + "'"; }

export function onboardingUrl(origin: string, owner: string): string {
  return origin + '/onboarding/setup?ownerMatrixId=' + encodeURIComponent(owner);
}

export function onboardingGuide(origin: string, owner: string, release: Manifest): string {
  return [
    '# Connect this project to Crossfire',
    '',
    'Server: ' + origin,
    'Owner: ' + owner,
    '',
    'Crossfire delivers authorized Matrix messages into this existing coding session through a project-local listener. It does not create another agent or change your model/permissions. Supported individual runtimes are Codex 0.158.0+, Claude Code 2.1.285+ and Pi 0.99.1+. Requires Linux, Node.js 26+, Git, Bash, curl and sha256sum. Native connection details stay private; never request ports, session IDs, tokens or Matrix passwords.',
    '',
    'Codex uses its existing launcher-provided app-server context. Claude Code supplies its native peer connection automatically; no channels flag, launcher or restart is required. For Pi first setup, set CROSSFIRE_RUNTIME=pi before the command below. Pi must trust this project and load its verified project extension with /reload once. Do not use Codex startup instructions for Claude Code or Pi.',
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
    'A runtime-setup-required result is not a connected listener. For Claude Code, let the successful installation command finish so native settings reload can activate the project hooks. A subsequent Bash tool call captures the exact native context; run agent connect again in that session without choosing another identity. For Pi, explain the one-time /reload activation to the user, then reconnect the same project identity. New Pi integration code also requires /reload on an upgrade; the native extension is never silently hot-replaced.',
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
    'if [ -n "${CROSSFIRE_RUNTIME:-}" ]; then options+=(--runtime "$CROSSFIRE_RUNTIME"); fi',
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
