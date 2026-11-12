use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use fleetd_domain::execution::Mount;
use std::{fmt::Write, path::Path};

pub const CHANNEL: &str = "org.ctlflow.execution.ssh";
pub const BOOT_TAG: &str = "ctlflow-boot";
pub const GUEST_ROOT: &str = "/run/ctlflow-execution";
pub fn tag(index: usize) -> String {
    format!("ctlflow-data-{index}")
}
fn quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}
fn invalid() -> Failure {
    Failure::new(
        ErrorCode::Invalid,
        "Invalid VM bootstrap identity, readiness location or exports",
    )
}
fn closing(id: &str, ready: &str) -> String {
    let closed = quote(&format!("{ready}.close"));
    format!("[ -f {closed} ] && [ \"$(cat {closed})\" = {} ]", quote(id))
}
pub fn completion(id: &str, ready: &str) -> Result<String> {
    crossfire_contracts::validation::identifier(&serde_json::json!(id))?;
    if !fleetd_contracts::configuration::absolute_path(ready) || ready.chars().any(char::is_control)
    {
        return Err(invalid());
    }
    Ok(format!(
        "code=0\nwait \"$server\" || code=$?\nexpected=false\nif {} && {{ [ \"$code\" -eq 0 ] || [ \"$code\" -eq 255 ]; }}; then expected=true; fi\n\
printf '{{\"event\":\"guest_ssh_exit\",\"expected\":%s,\"exitCode\":%s}}\\n' \"$expected\" \"$code\" >&2\n[ \"$expected\" = true ]\n",
        closing(id, ready)
    ))
}

pub fn ssh_configuration(listener_port: Option<u16>) -> Result<String> {
    if listener_port == Some(0) {
        return Err(invalid());
    }
    let listen =
        listener_port.map_or_else(|| "none".to_owned(), |port| format!("127.0.0.1:{port}"));
    Ok(format!(
        "HostKey {GUEST_ROOT}/ssh/server\nAuthorizedKeysFile {GUEST_ROOT}/ssh/authorized_keys\n\
AuthenticationMethods publickey\nPubkeyAuthentication yes\nPasswordAuthentication no\nKbdInteractiveAuthentication no\n\
PermitEmptyPasswords no\nPermitRootLogin prohibit-password\nUsePAM no\nAllowUsers root\nStrictModes yes\n\
AllowAgentForwarding no\nX11Forwarding no\nPermitUserEnvironment no\nPermitUserRC no\nAcceptEnv CROSSFIRE_PROVIDER_SECRET\n\
AllowTcpForwarding yes\nAllowStreamLocalForwarding no\nPermitOpen 127.0.0.1:*\nPermitListen {listen}\n\
GatewayPorts no\nMaxSessions 2048\nLogLevel VERBOSE\n"
    ))
}

pub fn script(id: &str, ready: &str, mounts: &[Mount]) -> Result<String> {
    crossfire_contracts::validation::identifier(&serde_json::json!(id))?;
    if !fleetd_contracts::configuration::absolute_path(ready)
        || ready.chars().any(char::is_control)
        || mounts.is_empty()
        || mounts.len() > 102
        || mounts.iter().any(|mount| {
            !mount.path.to_str().is_some_and(|path| {
                fleetd_contracts::configuration::absolute_path(path)
                    && !path.chars().any(char::is_control)
            })
        })
        || !mounts.iter().any(|mount| {
            !mount.read_only
                && Path::new(ready).starts_with(&mount.path)
                && Path::new(ready) != mount.path
        })
    {
        return Err(invalid());
    }
    let boot = format!("{GUEST_ROOT}/boot");
    let mut output = "#!/bin/sh\nset -eu\numask 077\n".to_owned();
    for (index, mount) in mounts.iter().enumerate() {
        let path = quote(mount.path.to_str().ok_or_else(invalid)?);
        writeln!(
            output,
            "mkdir -p -- {path}\nmount -t virtiofs -o {} -- {} {path}",
            if mount.read_only { "ro" } else { "rw" },
            quote(&tag(index))
        )
        .map_err(|_| invalid())?;
    }
    writeln!(output, "if {}; then exit 0; fi", closing(id, ready)).map_err(|_| invalid())?;
    write!(output, "mkdir -p {GUEST_ROOT}/ssh /run/sshd\nchmod 0700 {GUEST_ROOT}/ssh\nchmod 0755 /run/sshd\n\
cp -- {boot}/server {GUEST_ROOT}/ssh/server\ncp -- {boot}/authorized_keys {GUEST_ROOT}/ssh/authorized_keys\n\
chmod 0600 {GUEST_ROOT}/ssh/server {GUEST_ROOT}/ssh/authorized_keys\n\
/usr/sbin/usermod --password \"$(cat {boot}/account-hash)\" root\n\
/usr/sbin/sshd -t -f {boot}/sshd_config\n\
/usr/sbin/modprobe virtio_console\n/usr/bin/udevadm wait --timeout=30 --settle /dev/virtio-ports/{CHANNEL}\n\
exec 3<>/dev/virtio-ports/{CHANNEL}\n\
/usr/sbin/sshd -i -e -f {boot}/sshd_config <&3 >&3 &\nserver=$!\n\
printf '%s\\n' {} > {}\nmv -fT -- {} {}\n", quote(id), quote(&format!("{ready}.tmp")), quote(&format!("{ready}.tmp")), quote(ready)).map_err(|_| invalid())?;
    output.push_str(&completion(id, ready)?);
    Ok(output)
}

pub fn boot_command() -> String {
    format!(
        "set -eu; mkdir -p {GUEST_ROOT}/boot; mount -t virtiofs -o ro {BOOT_TAG} {GUEST_ROOT}/boot; exec /bin/sh {GUEST_ROOT}/boot/start.sh"
    )
}

pub fn start_command(network: fleetd_domain::execution::Network) -> Vec<String> {
    let mut command = vec![
        "/usr/bin/systemd-run",
        "--quiet",
        "--collect",
        "--no-block",
        "--service-type=exec",
        "--unit=ctlflow-execution",
    ]
    .into_iter()
    .map(str::to_owned)
    .collect::<Vec<_>>();
    if network == fleetd_domain::execution::Network::Outbound {
        command.extend(
            [
                "--property=After=network-online.target",
                "--property=Wants=network-online.target",
            ]
            .map(str::to_owned),
        );
    }
    command.extend(["/bin/sh".to_owned(), "-c".to_owned(), boot_command()]);
    command
}
