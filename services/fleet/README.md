# fleet

The CLI manages user-scoped fleetd controllers locally or through SSH. Every
Crossfire agent belongs to a fleet, including a one-agent project. fleetd owns
the shared listener and native sessions; the CLI uses its private API. Crossfire
owns enrollment, room permissions, wake rules and listener activity.

## Guides
- [Guide index](docs/README.md)
- [Installation and first fleet](docs/getting-started.md)
- [TOML files and all runtime settings](docs/configuration.md)
- [Command reference and lifecycle](docs/commands.md)
- [Remote controllers and native terminal pointers](docs/remote.md)
- [Updates, backups and troubleshooting](docs/operations.md)
- [Controller API and ownership](https://github.com/control-flow-project/crossfire/blob/main/services/fleetd/README.md)
- [Crossfire management](https://github.com/control-flow-project/crossfire/blob/main/services/crossfire/docs/management.md)

## First setup

Open the personalized setup guide from Crossfire management. Its command installs
the exact public `@ctlflow/fleet` release in private user storage and invokes:

```sh
fleet setup --descriptor 'https://YOUR_SERVER/onboarding/setup.json?ownerMatrixId=ENCODED_OWNER_MATRIX_ID'
```

Run from the project directory. Setup asks no configuration questions. It starts
or reuses the private controller, persists stable names, requests real human
approval and verifies model-free listener readiness. The coding session doing
setup stays independent; it is not adopted. Native project files and its existing
`.codex` configuration/history are not overwritten. Optional
`--config /absolute/runtime.toml` uses the same ordinary fleet model.

Repeated setup reuses the controller, fleet, accounts and managed histories.
Explicitly stopped agents stay stopped. Normal `fleet start FLEET` resumes full
saved history; only `--fresh-history` requests replacement. Read-only commands
never start a controller or wake a native session. `fleet test FLEET` checks
actual listener/authentication/native readiness without a model turn.

`fleet enroll FLEET` reviews a stopped registered fleet without starting sessions.
Use it for additional agents or proposed public names while retaining histories.
Only the human owner approves the exact roster/code; immutable instance keys and
workareas remain unchanged. See [enrollment operations](docs/operations.md#enroll-without-starting).

Startup creates no chats. Private owner DMs open on first contact, visible output
or native permission request; additional room membership is explicit.

Codex defaults to `danger-full-access` and `on-request`. Sandbox, approval
policy, model and reasoning remain configurable in the definition's
`[runtime_options]`. The native-named
`dangerously_bypass_approvals_and_sandbox = true` selects full access without
approvals; it is never enabled implicitly.

## License

Copyright (c) 2026 Jeswin P Kumar. All rights reserved.

First-party code, documentation and assets are proprietary and require a separate
written commercial license. See [LICENSE](LICENSE). Contact: jeswinpk@agilehead.com.
Third-party software and materials retain their own licenses.
