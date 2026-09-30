import type { Manifest } from './release.js';

function quote(value: string): string { return "'" + value.replaceAll("'", "'\\''") + "'"; }
export function onboardingUrl(origin: string, owner: string): string {
  return origin + '/onboarding/setup?ownerMatrixId=' + encodeURIComponent(owner);
}
export function onboardingGuide(origin: string, owner: string, release: Manifest, instructions = ''): string {
  return [
    '# Connect your current coding session to Crossfire',
    '',
    'Crossfire lets people chat with this agent through Matrix. This guide connects the current coding session, not a new agent engine. The listener handles delivery, wake rules and activity reporting in ordinary code.',
    'Server: ' + origin, 'Owner requested for this setup: ' + owner,
    '',
    '## 1. Check this project and prerequisites',
    'Work in the project directory selected by the human. Support: Linux or macOS, Node.js 26+, Git, Bash, curl, and Codex 0.158.0+ using its native app server. Inspect this trusted server’s client before running it. Never ask for Matrix passwords, administrator credentials, ports, UUIDs or tokens.',
    'Check node --version, git --version, curl --version, and codex --version. If a prerequisite is missing, explain what is needed and help install it within the human’s normal permission policy. Official installers: https://nodejs.org/en/download ; https://git-scm.com/downloads ; https://curl.se/download.html ; https://developers.openai.com/codex/cli . Do not silently use sudo, change system settings or install global skills.',
    'Codex’s native local app-server socket and tool-provided thread identity select this exact session automatically. The optional runcodex.sh download is NOT required. Embedded / --no-daemon sessions expose no app-server connection: explain the limitation and ask the human to reopen/resume their saved session in normal app-server-backed Codex. Native daemon start is codex app-server daemon start; never silently launch a second engine or guess another session.',
    '',
    '## 2. Connect or reuse the saved account',
    'The client stores an approved Matrix account and listener settings privately under this project’s Git-ignored .crossfire/profiles directory. That saved account is the agent’s identity. The client discovers and reuses it automatically for reconnects and upgrades. Do not propose a second identity.',
    'Only when the client reports that no profile exists, ask what to call the agent. Set CROSSFIRE_AGENT_NAME to a lowercase name using letters, digits and hyphens, then rerun. If several profiles exist, ask which one to use. Do not ask the human to find technical connection details.',
    'Inspect and run the following Bash command. Size and SHA-256 verify the downloaded bytes against this server, not an independent publisher identity.',
    '', '```bash', onboardingCommand(origin, owner, release), '```', '',
    'If awaiting approval, show the exact approval URL and verification code immediately while the command continues waiting. A new account requires human approval once. The command resumes automatically after approval; never model-poll or start a separate listener.',
    'Read changed skill content returned in the command output. Approval alone grants no rooms. The owner controls room access separately; zero rooms is a valid connected state. Never join rooms without an explicit grant.',
    '',
    '## 3. Test the actual listener',
    'Run node .crossfire/client.mjs agent test. It tests the live listener, exact native session, authenticated server access and granted/joined rooms without sending a model prompt. No listener, stale credentials or a closed session is a failed test, not a successful connection. Zero rooms is reported separately: it cannot receive room tasks yet.',
    'Give the human the connection/test result and management URL. Later reconnects or approved upgrades use node .crossfire/client.mjs agent connect. No new enrollment is needed.',
    'If the listener announces a new release, ask the human whether to update. Only after consent, run connect again and read any changed skill from its output. A running listener is never silently replaced.',
    ...(instructions ? ['', '## Additional instructions from the system administrator', instructions] : []),
    '',
  ].join('\n');
}
export function onboardingCommand(origin: string, owner: string, release: Manifest): string {
  const client = release.artifacts['crossfire-client.mjs'];
  return [
    'set -eu', 'umask 077',
    'command -v node >/dev/null || { printf "%s\\n" "Install Node.js 26+: https://nodejs.org/en/download" >&2; exit 1; }',
    'node -e \'if(Number(process.versions.node.split(".")[0]) < 26) { console.error("Install Node.js 26+: https://nodejs.org/en/download"); process.exit(1); }\'',
    'command -v git >/dev/null || { printf "%s\\n" "Install Git: https://git-scm.com/downloads" >&2; exit 1; }',
    'options=()',
    'if [ -n "${CROSSFIRE_AGENT_NAME:-}" ]; then options=(--profile "$CROSSFIRE_AGENT_NAME"); fi',
    'command -v curl >/dev/null || { printf "%s\\n" "Install curl: https://curl.se/download.html" >&2; exit 1; }',
    'temporary=$(mktemp -d "${TMPDIR:-/tmp}/crossfire-setup.XXXXXX")',
    'trap \'rm -f -- "$temporary/crossfire-client.mjs"; rmdir -- "$temporary"\' EXIT',
    'client="$temporary/crossfire-client.mjs"',
    'curl --fail --silent --show-error --max-time 30 --max-filesize ' + client.bytes + ' --output "$client" ' + quote(origin + '/onboarding/' + release.release + '/crossfire-client.mjs'),
    'node --input-type=module -e \'import {readFileSync} from "node:fs"; import {createHash} from "node:crypto"; const bytes=readFileSync(process.argv[1]); if(bytes.length !== Number(process.argv[2]) || createHash("sha256").update(bytes).digest("hex") !== process.argv[3]) throw new Error("Crossfire download verification failed");\' "$client" ' + client.bytes + ' ' + quote(client.sha256),
    'node "$client" --project "$PWD" ${options[@]+"${options[@]}"} agent connect --server ' + quote(origin) + ' --owner ' + quote(owner),
  ].join('\n');
}
