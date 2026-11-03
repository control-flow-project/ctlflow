pub enum Part {
    Text(&'static str),
    Origin,
    Owner,
    Version,
    Descriptor,
}
pub const GUIDE: &[Part] = &[
    Part::Text(
        "# Set up a crossfire agent\n\ncrossfire lets people message managed agents through Messaging. fleetd owns each agent’s native session and the shared listener; a single agent is an ordinary one-agent fleet.\nThese instructions are for the coding harness performing setup. Run them on the computer where native agents will execute; Docker hosts the server only. Install the matching native fleet and fleetd distribution into private user-owned storage; NativeAOT is the default. Keep its packaged directories and artifacts together. The selected Codex/Pi installation and native login must already exist there. Do not install or upgrade a harness or copy provider credentials into Docker. NativeAOT and Rust distributions do not require Node.js or a .NET runtime to execute fleet or fleetd. The optional intentional messaging tools and the selected Pi harness retain their own Node.js prerequisites. Do not attach this coding session; fleetd starts a separate managed native session.\nServer: ",
    ),
    Part::Origin,
    Part::Text("\nVerified human owner: "),
    Part::Owner,
    Part::Text(
        "\n\n## 1. Check prerequisites\nUse the human-selected project directory on Linux x64. Requires the matching native fleet/fleetd distribution, Git, Bash and an existing supported native harness with provider login. Codex is the default; Earendil Pi requires explicit ordinary fleet configuration. Check the installed distribution version, git --version and the selected harness version. The controller performs model-free native capability and authentication checks before enrolling or starting an agent.\nIf a prerequisite or provider login is missing, stop and report it. The user must install missing prerequisites or complete the selected harness native login before repeating setup. Never install or upgrade Codex/Pi as part of these instructions. Official prerequisite documentation: https://nodejs.org/en/download ; https://git-scm.com/downloads ; https://developers.openai.com/codex/cli . Never request Messaging passwords, administrator tokens, ports or session IDs. Do not use sudo, change host services or install global skills.\nThis coding session only performs setup. It stays independent: its process, conversation and project-native settings are not adopted or imported. fleetd creates a separate managed session. Subsequent resume and wake reuse that managed session’s saved histories. Linux inert-provider checks are not macOS or paid-provider certification.\n\n## 2. Run the complete setup command\nInspect and run this Bash command from the project directory. It uses the installed native CLI/controller and runs one noninteractive setup operation. The descriptor checks the exact installed release version; it never downloads or substitutes another implementation. It asks no naming, model, controller or room questions. Stable names and state are derived and persisted automatically.\n\n```bash\nset -eu\numask 077\ncommand -v fleet >/dev/null || { printf \"%s\\n\" \"Install the native ctlflow ",
    ),
    Part::Version,
    Part::Text(
        " distribution and put fleet on PATH.\" >&2; exit 1; }\ncommand -v git >/dev/null || { printf \"%s\\n\" \"Install Git: https://git-scm.com/downloads\" >&2; exit 1; }\nfleet setup --descriptor ",
    ),
    Part::Descriptor,
    Part::Text("\n```\n\nOptional overrides use fleet setup --descriptor "),
    Part::Descriptor,
    Part::Text(
        " --config /absolute/runtime.toml. Do not generate a configuration just to repeat defaults.\nWhen awaiting approval, immediately show the exact approval URL and matching code to the human. Ordinary controller code continues waiting and resumes after approval; do not model-poll, enroll twice or start a separate listener. Human approval remains required authorization.\nRepeated setup reuses the selected project, controller, fleet, identities and histories. It never silently upgrades software or activates explicitly stopped sessions. Errors are actionable failures, not prompts to guess another identity.\n\n## 3. Confirm readiness and room access\nSetup returns the fleet identity and model-free readiness result. Use fleet test FLEET_KEY to verify the receiver, fleet daemon status to inspect the controller and fleet show FLEET_KEY for read-only session details, using the returned fleet key. These checks never start or wake a stopped session. A controller process or saved credentials alone do not prove delivery is ready. Busy, paused, sleeping and stopped states are distinct; no artificial test message or model turn is needed.\nEnrollment creates no rooms or conversations. Humans create rooms in Element and invite the agent; authorized invitations grant read/reply access. Wake-up rules separately determine which senders trigger a turn. The first owner DM, actual terminal output or pending decision establishes a protected private owner conversation.\nThe managed agent can check its receiver using node \"$CROSSFIRE_PROJECT/.crossfire/client.mjs\" agent test. It does not start a listener, make a model call or advance unread positions.\nReport the setup result and ",
    ),
    Part::Origin,
    Part::Text(
        "/manage/fleets to the human. Lifecycle, fresh-history confirmations, model parameters, terminal pointers and software versions are available in management.\n\n## Software updates\nfleet and fleetd are native distribution executables. npm workspaces are private build, UI, test and maintenance dependencies; they do not install services. A new release may notify the managed agent once. With human consent, install the matching native distribution into a new private release directory, run fleet update FLEET_KEY and restart the controller with fleet daemon restart. Explicitly stopped agents remain stopped; running agents resume their saved histories. Read changed skill content after the verified update. Do not replace a live receiver or re-enroll.\n",
    ),
];
