pub enum Part {
    Text(&'static str),
    Origin,
    Owner,
    Version,
    Descriptor,
}
pub const GUIDE: &[Part] = &[
    Part::Text(
        "# Set up a crossfire agent\n\ncrossfire lets people message managed agents through Matrix. fleetd owns each agent’s native session and the shared listener; a single agent is an ordinary one-agent fleet.\nThese instructions are for the coding harness performing setup. Always install the Node.js @ctlflow/fleet CLI and its Node.js fleetd dependency, regardless of the server implementation. Fleet attachment does not require .NET or a C# controller. Do not attach this coding session; fleetd starts a separate managed native session.\nServer: ",
    ),
    Part::Origin,
    Part::Text("\nVerified human owner: "),
    Part::Owner,
    Part::Text(
        "\n\n## 1. Check prerequisites\nUse the human-selected project directory on Linux or macOS. Requires Node.js 26+, npm, Git, Bash and Codex. Check node --version, npm --version, git --version and codex --version. The controller performs model-free native capability and authentication checks before enrolling or starting an agent.\nIf something is missing, help install it within the human’s normal permission policy. Official installation instructions: https://nodejs.org/en/download ; https://git-scm.com/downloads ; https://developers.openai.com/codex/cli . Provider login uses native Codex authentication. Never request Matrix passwords, administrator tokens, ports or session IDs. Do not silently use sudo, change host services or install global skills.\nThis coding session only performs setup. It stays independent: its process, conversation and project-native settings are not adopted or imported. fleetd creates a separate managed session. Subsequent resume and wake reuse that managed session’s saved histories. Linux inert-provider checks are not macOS or paid-provider certification.\n\n## 2. Run the complete setup command\nInspect and run this Bash command from the project directory. It installs the pinned public CLI/controller into private user-owned storage and runs one noninteractive setup operation. It asks no naming, model, controller or room questions. Stable names and state are derived and persisted automatically.\n\n```bash\nset -eu\numask 077\ncommand -v node >/dev/null || { printf \"%s\\n\" \"Install Node.js 26+: https://nodejs.org/en/download\" >&2; exit 1; }\nnode -e 'if(Number(process.versions.node.split(\".\")[0]) < 26) { console.error(\"Install Node.js 26+: https://nodejs.org/en/download\"); process.exit(1); }'\ncommand -v npm >/dev/null || { printf \"%s\\n\" \"Install npm with Node.js: https://nodejs.org/en/download\" >&2; exit 1; }\ncommand -v git >/dev/null || { printf \"%s\\n\" \"Install Git: https://git-scm.com/downloads\" >&2; exit 1; }\ncommand -v codex >/dev/null || { printf \"%s\\n\" \"Install Codex: https://developers.openai.com/codex/cli\" >&2; exit 1; }\ninstallation=$(node --input-type=module - '",
    ),
    Part::Version,
    Part::Text(
        "' <<'NODE'\nimport { lstatSync, mkdirSync, realpathSync } from \"node:fs\";\nimport { homedir } from \"node:os\";\nimport { join } from \"node:path\";\nlet directory = realpathSync(homedir());\nfor (const part of [\".local\", \"share\", \"ctlflow\", \"releases\", process.argv[2]]) {\n  directory = join(directory, part);\n  try { mkdirSync(directory, { mode: 0o700 }); } catch (error) { if (error.code !== \"EEXIST\") throw error; }\n  const stat = lstatSync(directory);\n  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid() || (stat.mode & 0o022)) throw new Error(\"Unsafe private installation directory\");\n}\nconsole.log(directory);\nNODE\n)\nnpm install --prefix \"$installation\" --ignore-scripts --omit=dev --no-audit --no-fund --save-exact '@ctlflow/fleet@",
    ),
    Part::Version,
    Part::Text("'\n\"$installation/node_modules/.bin/fleet\" setup --descriptor "),
    Part::Descriptor,
    Part::Text("\n```\n\nOptional overrides use fleet setup --descriptor "),
    Part::Descriptor,
    Part::Text(
        " --config /absolute/runtime.toml. Do not generate a configuration just to repeat defaults.\nWhen awaiting approval, immediately show the exact approval URL and matching code to the human. Ordinary controller code continues waiting and resumes after approval; do not model-poll, enroll twice or start a separate listener. Human approval remains required authorization.\nRepeated setup reuses the selected project, controller, fleet, identities and histories. It never silently upgrades software or activates explicitly stopped sessions. Errors are actionable failures, not prompts to guess another identity.\n\n## 3. Confirm readiness and room access\nSetup returns the fleet identity and model-free readiness result. Use fleet test FLEET_KEY to verify the receiver, fleet daemon status to inspect the controller and fleet show FLEET_KEY for read-only session details, using the returned fleet key. These checks never start or wake a stopped session. A controller process or saved credentials alone do not prove delivery is ready. Busy, paused, sleeping and stopped states are distinct; no artificial test message or model turn is needed.\nEnrollment creates no rooms or conversations. Humans create rooms in Element and invite the agent; authorized invitations grant read/reply access. Wake-up rules separately determine which senders trigger a turn. The first owner DM, actual terminal output or pending decision establishes a protected private owner conversation.\nThe managed agent can check its receiver using node \"$CROSSFIRE_PROJECT/.crossfire/client.mjs\" agent test. It does not start a listener, make a model call or advance unread positions.\nReport the setup result and ",
    ),
    Part::Origin,
    Part::Text(
        "/manage/fleets to the human. Lifecycle, fresh-history confirmations, model parameters, terminal pointers and software versions are available in management.\n\n## Software updates\nOnly @ctlflow/fleet and @ctlflow/fleetd are public npm packages. Internal modules stay bundled and private. A new release may notify the managed agent once. With human consent, install the pinned package version into the private installation, run fleet update FLEET_KEY and restart the controller with fleet daemon restart. Explicitly stopped agents remain stopped; running agents resume their saved histories. Read changed skill content after the verified update. Do not replace a live receiver or re-enroll.\n",
    ),
];
