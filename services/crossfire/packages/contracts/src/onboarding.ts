import type { Manifest } from './release.js';

export type SetupDescriptor = {
  schemaVersion: 1;
  server: string;
  ownerMatrixId: string;
  package: { name: '@ctlflow/fleet'; version: string };
  instructions: string;
};

function quote(value: string): string { return "'" + value.replaceAll("'", "'\\''") + "'"; }
export function onboardingUrl(origin: string, owner: string): string {
  return origin + '/onboarding/setup?ownerMatrixId=' + encodeURIComponent(owner);
}
export function setupDescriptorUrl(origin: string, owner: string): string {
  return origin + '/onboarding/setup.json?ownerMatrixId=' + encodeURIComponent(owner);
}
export function setupDescriptor(origin: string, owner: string, release: Manifest, instructions = ''): SetupDescriptor {
  return { schemaVersion: 1, server: origin, ownerMatrixId: owner,
    package: { name: '@ctlflow/fleet', version: release.version }, instructions };
}

export function onboardingCommand(origin: string, owner: string, release: Manifest): string {
  return [
    'set -eu', 'umask 077',
    'command -v node >/dev/null || { printf "%s\\n" "Install Node.js 26+: https://nodejs.org/en/download" >&2; exit 1; }',
    'node -e \'if(Number(process.versions.node.split(".")[0]) < 26) { console.error("Install Node.js 26+: https://nodejs.org/en/download"); process.exit(1); }\'',
    'command -v npm >/dev/null || { printf "%s\\n" "Install npm with Node.js: https://nodejs.org/en/download" >&2; exit 1; }',
    'command -v git >/dev/null || { printf "%s\\n" "Install Git: https://git-scm.com/downloads" >&2; exit 1; }',
    'command -v codex >/dev/null || { printf "%s\\n" "Install Codex: https://developers.openai.com/codex/cli" >&2; exit 1; }',
    'installation=$(node --input-type=module - ' + quote(release.version) + ' <<\'NODE\'',
    'import { lstatSync, mkdirSync, realpathSync } from "node:fs";',
    'import { homedir } from "node:os";',
    'import { join } from "node:path";',
    'let directory = realpathSync(homedir());',
    'for (const part of [".local", "share", "ctlflow", "releases", process.argv[2]]) {',
    '  directory = join(directory, part);',
    '  try { mkdirSync(directory, { mode: 0o700 }); } catch (error) { if (error.code !== "EEXIST") throw error; }',
    '  const stat = lstatSync(directory);',
    '  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid() || (stat.mode & 0o022)) throw new Error("Unsafe private installation directory");',
    '}',
    'console.log(directory);',
    'NODE', ')',
    'npm install --prefix "$installation" --ignore-scripts --omit=dev --no-audit --no-fund --save-exact ' + quote('@ctlflow/fleet@' + release.version),
    '"$installation/node_modules/.bin/fleet" setup --descriptor ' + quote(setupDescriptorUrl(origin, owner)),
  ].join('\n');
}

export function onboardingGuide(origin: string, owner: string, release: Manifest, instructions = ''): string {
  return [
    '# Set up a Crossfire agent',
    '',
    'Crossfire lets people message managed agents through Matrix. fleetd owns each agent’s native session and the shared listener; a single agent is an ordinary one-agent fleet.',
    'Server: ' + origin, 'Verified human owner: ' + owner,
    '',
    '## 1. Check prerequisites',
    'Use the human-selected project directory on Linux or macOS. Requires Node.js 26+, npm, Git, Bash and Codex. Check node --version, npm --version, git --version and codex --version. The controller performs model-free native capability and authentication checks before enrolling or starting an agent.',
    'If something is missing, help install it within the human’s normal permission policy. Official installation instructions: https://nodejs.org/en/download ; https://git-scm.com/downloads ; https://developers.openai.com/codex/cli . Provider login uses native Codex authentication. Never request Matrix passwords, administrator tokens, ports or session IDs. Do not silently use sudo, change host services or install global skills.',
    'This coding session only performs setup. It stays independent: its process, conversation and project-native settings are not adopted or imported. fleetd creates a separate managed session. Subsequent resume and wake reuse that managed session’s saved histories. Linux inert-provider checks are not macOS or paid-provider certification.',
    '',
    '## 2. Run the complete setup command',
    'Inspect and run this Bash command from the project directory. It installs the pinned public CLI/controller into private user-owned storage and runs one noninteractive setup operation. It asks no naming, model, controller or room questions. Stable names and state are derived and persisted automatically.',
    '', '```bash', onboardingCommand(origin, owner, release), '```', '',
    'Optional overrides use fleet setup --descriptor ' + quote(setupDescriptorUrl(origin, owner)) + ' --config /absolute/runtime.toml. Do not generate a configuration just to repeat defaults.',
    'When awaiting approval, immediately show the exact approval URL and matching code to the human. Ordinary controller code continues waiting and resumes after approval; do not model-poll, enroll twice or start a separate listener. Human approval remains required authorization.',
    'Repeated setup reuses the selected project, controller, fleet, identities and histories. It never silently upgrades software or activates explicitly stopped sessions. Errors are actionable failures, not prompts to guess another identity.',
    '',
    '## 3. Confirm readiness and room access',
    'Setup returns the fleet identity and model-free readiness result. Use fleet status for a read-only follow-up. A controller process or saved credentials alone do not prove delivery is ready. Busy, paused, sleeping and stopped states are distinct; no artificial test message or model turn is needed.',
    'Enrollment creates no rooms or conversations. Humans create rooms in Element and invite the agent; authorized invitations grant read/reply access. Wake-up rules separately determine which senders trigger a turn. The first owner DM, actual terminal output or pending decision establishes a protected private owner conversation.',
    'The managed agent can check its receiver using node "$CROSSFIRE_PROJECT/.crossfire/client.mjs" agent test. It does not start a listener, make a model call or advance unread positions.',
    'Report the setup result and ' + origin + '/manage/fleets to the human. Lifecycle, fresh-history confirmations, model parameters, terminal pointers and software versions are available in management.',
    '',
    '## Software updates',
    'Only @ctlflow/fleet and @ctlflow/fleetd are public npm packages. Internal modules stay bundled and private. A new release may notify the managed agent once; request human consent before updating the controller package and running fleet update. Read changed skill content after the verified update. Do not replace a live receiver or re-enroll.',
    ...(instructions ? ['', '## Instructions from this instance’s administrator', instructions] : []),
    '',
  ].join('\n');
}
