# Remote controllers

Remote Fleet commands use SSH forwarding to fleetd's private Unix socket.
The controller has no public HTTP/TCP management port.

```sh
fleet remote add office --ssh operator@office-host --root /absolute/private/controller
fleet --remote office list
fleet --remote office show research
fleet --remote office agent contexts research analyst-east
fleet --remote office agent attach research analyst-east
```

Use normal SSH authentication and host-key verification. A profile contains the
connection description, not copied SSH/provider credentials. Do not disable host
verification to make setup pass. Remote filesystem paths refer to the controller
host, not the laptop running Fleet.

Attachment wraps the runtime adapter's exact command through the verified SSH
connection. The native endpoint remains loopback-only; its private token is read
on the controller host, not printed or copied into the profile.
Closing the CLI or native TUI does not stop the managed engine.

Remote update consumes already installed remote assets:

```sh
fleet --remote office update research \
  --release-directory /absolute/private/install/node_modules/@ctlflow/fleetd/dist/assets
```

Install the selected release there first and restart the controller using its new
executable. There is no HTTP download fallback, process adoption or guessed
remote session.

- [Commands](commands.md)
- [Update procedure](operations.md)
