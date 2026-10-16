# Fleet CLI

Fleet controls a user-scoped fleetd controller over its private API.
Local and SSH commands use the same operation path. The CLI does not launch
native agents or write controller state directly.

- [Setup](docs/getting-started.md)
- [Commands](docs/commands.md)
- [Fleet and role configuration](docs/configuration.md)
- [Stop, resume and reset](docs/sessions.md)
- [Remote controllers](docs/remote.md)
- [Software updates and diagnosis](docs/operations.md)
- [Pi runtime](docs/pi.md)

Node source lives under `node/`; C# source under `csharp/`.
External behavior is tested under `tests/contracts/`.
`@ctlflow/fleet` may be publicly distributed; first-party licensing remains
proprietary. Internal dependencies are bundled, not published separately.

- [License](LICENSE)
