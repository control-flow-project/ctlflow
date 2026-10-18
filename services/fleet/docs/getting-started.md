# Set up a fleet

## From management

Open crossfire's Set up an agent page. Paste the personalized guide into a coding
assistant. The guide pins the public fleet package to the instance's release and
runs noninteractive setup:

The generated installer uses
`$HOME/.local/share/ctlflow/releases/<version>/node_modules/.bin/fleet`.
Its exact fleetd dependency is installed alongside it; nothing is installed
globally. The guide invokes that private executable directly. Examples using
`fleet` below assume you use that executable or add its directory to your PATH.

```sh
fleet setup --descriptor 'https://example.test/onboarding/setup.json?ownerMatrixId=%40member%3Aexample.test'
```

Use the actual personalized URL, not this example.
Setup validates the exact owner, origin and installed release. It creates/reuses
a private controller and a project-derived one-agent fleet, displays the exact
approval code/URL, waits for owner approval in ordinary code, then checks readiness.
No configuration questions or dummy model prompts are issued.

The coding assistant's own process, history and permissions remain independent.
fleetd creates a separate managed session. Existing approved identity/history
is reused on repeated setup; an explicitly stopped binding stays stopped.
Run the guide on the machine where agents will execute, not inside the crossfire
container. Docker hosts the server side only. No Docker mount or copy of host
provider credentials is part of fleet setup.

## Prerequisites

The personalized guide installs exact public @ctlflow/fleet and Node fleetd
through npm on Linux/macOS. It remains npm-based for every server backend and
does not assume .NET/Rust is installed. Native fleet/controller distributions
are explicit operator choices with separate guides; their CLI selects its
sibling controller, not a different implementation on PATH.

- [Installation and packaging by target](https://github.com/control-flow-project/ctlflow/blob/main/docs/distributions/README.md)

The host must already have Node.js, npm, Git, Bash, the selected native runtime
and its provider login. The guide installs only fleet/fleetd, not Codex or Pi.
Codex is the default. Pi requires an explicit ordinary roster and verified native
1.0.0. Setup reports missing prerequisites; it does not silently upgrade a runtime,
copy the current coding conversation or weaken native permissions.
Missing prerequisites stop setup with an actionable error. The user installs
missing software or signs in through the selected harness, then repeats setup.

## Optional configuration

```sh
fleet setup --descriptor 'https://example.test/onboarding/setup.json?ownerMatrixId=%40member%3Aexample.test' \
  --root /absolute/private/controller \
  --config /absolute/private/fleet/runtime.toml
```

The configuration must match the descriptor's server and owner.
Unknown fields, duplicate names and unavailable model/effort combinations fail.
Role definitions, skills and workareas follow the normal fleet loader.

## After approval

1. Inspect `fleet list`, `fleet show FLEET` and `fleet agent list FLEET`.
2. Run `fleet test FLEET` for model-free readiness.
3. Create ordinary rooms in Element and grant only needed participation.
4. Configure wake senders independently of room membership.
5. Send an actual authorized task through the room, DM or explicit fleet message.

Enrollment creates no chats. Owner DMs are lazy and protected.
Closing the CLI does not stop the controller.

- [Configuration](configuration.md)
- [Commands](commands.md)
- [Sessions and restart](sessions.md)
