# Controller authentication

Every fleetd HTTP operation requires `Authorization: Bearer <authenticationKey>`,
including status and inspection. There are no anonymous endpoints. Missing or
incorrect credentials return 401. Origin or Cookie headers, even empty ones,
and a non-localhost Host return 403. The API remains a private Unix socket;
authentication does not add a TCP port.

## One configuration per OS user

| Host | Configuration file |
| --- | --- |
| Linux | `$XDG_CONFIG_HOME/ctlflow/fleetd.json`, or `$HOME/.config/ctlflow/fleetd.json` when XDG_CONFIG_HOME is unset |
| macOS | `$HOME/Library/Application Support/ctlflow/fleetd.json`; XDG_CONFIG_HOME is ignored |

Paths must be absolute and normalized; empty/relative Linux XDG_CONFIG_HOME fails.
The directory must be private, owned and free of symlink traversal; the file must
be owned, private, regular and single-link. New modes are 0700/0600. Existing
unsafe state is rejected, not silently chmodded or replaced.

On first normal start, fleetd creates the directory/configuration and stores a
cryptographically random 256-bit key as 64 lowercase hexadecimal characters.
Initialization is atomic and serialized across controllers. Restarts retain it.
A valid keyless `{"schemaVersion":1}` configuration receives a new key. Malformed
JSON, unknown/duplicate fields, invalid keys and files over 4096 bytes fail
without overwriting the configuration. The complete schema has required integer
schemaVersion 1 and optional authenticationKey during initialization. Client use
always requires a key.

Do not print, commit, paste into prompts or copy the key into fleet configuration.
All controller roots belonging to this OS user share it. Anyone able to read the
configuration is trusted with full controller authority. This is not per-fleet
authorization or isolation between applications running as that user. crossfire
enrollment credentials remain separate.

## Local and remote clients

fleet reads this exact file before local calls; it never creates a key. Status
does not launch a daemon or create configuration. Setup/daemon start can launch
fleetd, which initializes the key before accepting requests. Installation itself
still starts no process.

Remote fleet reads the remote user's configuration through strict-host-key SSH,
validates private ownership/mode and bounded contents, then holds the key in
memory while forwarding the same API. It does not use the local key, save a
remote copy, or put secrets in argv, profiles or errors. The noninteractive
SSH environment must select the same HOME/XDG_CONFIG_HOME as the controller.
A missing remote key fails; start fleetd on that host first.

Node supports Linux/macOS controllers. Current C#/Rust native distributions and
filesystem adapters are verified on Linux x64 only; matching path rules do not
establish native macOS runtime support.

## Upgrade and recovery

Back up this private configuration alongside controller roots, fleet state,
credentials and histories. Preserve its location/environment on restart. Moving
a controller root does not move or regenerate the key.

When upgrading from a release without authentication, stop the old daemon
normally with its matching old CLI. Install coordinated new fleet/fleetd, then
start with the original root. The new CLI cannot control an old unauthenticated
daemon; there is no compatibility path.

For rotation, stop every controller using this key. Update the private file or
remove only authenticationKey and let the next start initialize it. Restart the
controllers and reconnect remote clients. Do not rotate under live controllers
or delete controller/native state to resolve authentication failure. Restore a
verified key backup when that is the intended recovery.
