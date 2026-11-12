use crate::NativeCommand;
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use std::{collections::BTreeMap, ffi::OsString, path::Path};

#[derive(Clone)]
pub struct SshExecution {
    pub directory: std::path::PathBuf,
    pub id: String,
}

pub const GUEST_PATH: &str = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
pub const PROVIDER_KEY: &str = "CROSSFIRE_PROVIDER_ENV_KEY";
pub const PROVIDER_SECRET: &str = "CROSSFIRE_PROVIDER_SECRET";
const ENVIRONMENT_KEYS: &[&str] = &[
    "CODEX_HOME",
    "PI_CODING_AGENT_DIR",
    "CROSSFIRE_PROJECT",
    "CROSSFIRE_AGENT_NAME",
];
fn invalid(message: &str) -> Failure {
    Failure::new(ErrorCode::Invalid, message)
}
fn quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}
fn text(value: &str) -> bool {
    !value.contains('\0') && value.len() <= 1_048_576
}
fn valid(directory: &Path, id: &str) -> bool {
    directory.to_str().is_some_and(|path| {
        absolute(path)
            && path.len() < 70
            && path.chars().all(|character| {
                character.is_ascii_alphanumeric() || matches!(character, '/' | '.' | '-' | '_')
            })
    }) && crossfire_kernel::identifier::uuid(id)
}
fn absolute(path: &str) -> bool {
    path.starts_with('/')
        && !path.contains(['\\', '\0'])
        && path
            .split('/')
            .skip(1)
            .all(|part| !part.is_empty() && part != "." && part != "..")
}
fn alias(id: &str) -> String {
    format!("ctlflow-{id}")
}
fn command(directory: &Path, arguments: Vec<OsString>, input: bool) -> NativeCommand {
    NativeCommand {
        binary: "/usr/bin/ssh".into(),
        arguments,
        workspace: directory.to_owned(),
        environment: BTreeMap::new(),
        input,
    }
}
fn multiplex(directory: &Path) -> Vec<OsString> {
    vec![
        "-F".into(),
        "/dev/null".into(),
        "-T".into(),
        "-S".into(),
        directory.join("mux").into_os_string(),
        "-o".into(),
        "ControlMaster=no".into(),
        "-o".into(),
        "BatchMode=yes".into(),
        "-o".into(),
        "IdentityAgent=none".into(),
        "-o".into(),
        "ProxyCommand=/usr/bin/false".into(),
    ]
}
pub fn master(directory: &Path, id: &str, listener_port: Option<u16>) -> Result<NativeCommand> {
    if !valid(directory, id) || listener_port == Some(0) {
        return Err(invalid(
            "Invalid private VM SSH connection identity or listener port",
        ));
    }
    let path = directory
        .to_str()
        .ok_or_else(|| invalid("Invalid private VM SSH directory"))?;
    let mut arguments = vec![
        "-F".into(),
        "/dev/null".into(),
        "-M".into(),
        "-N".into(),
        "-T".into(),
        "-S".into(),
        directory.join("mux").into_os_string(),
        "-o".into(),
        "BatchMode=yes".into(),
        "-o".into(),
        "IdentitiesOnly=yes".into(),
        "-o".into(),
        "IdentityAgent=none".into(),
        "-i".into(),
        directory.join("client").into_os_string(),
        "-o".into(),
        "StrictHostKeyChecking=yes".into(),
        "-o".into(),
        "GlobalKnownHostsFile=/dev/null".into(),
        "-o".into(),
        format!("UserKnownHostsFile={path}/known_hosts").into(),
        "-o".into(),
        format!("HostKeyAlias={}", alias(id)).into(),
        "-o".into(),
        "ConnectionAttempts=1".into(),
        "-o".into(),
        "ConnectTimeout=30".into(),
        "-o".into(),
        "ExitOnForwardFailure=yes".into(),
        "-o".into(),
        format!("SendEnv={PROVIDER_SECRET}").into(),
        "-o".into(),
        format!(
            "ProxyCommand=/usr/bin/nc -N -U {}",
            quote(&format!("{path}/channel"))
        )
        .into(),
    ];
    if let Some(port) = listener_port {
        arguments.extend([
            "-R".into(),
            format!("127.0.0.1:{port}:127.0.0.1:{port}").into(),
        ]);
    }
    arguments.push(format!("root@{}", alias(id)).into());
    let mut master = command(directory, arguments, false);
    master.environment.insert(PROVIDER_SECRET.into(), None);
    Ok(master)
}
pub fn place(directory: &Path, id: &str, native: &NativeCommand) -> Result<NativeCommand> {
    let workspace = native
        .workspace
        .to_str()
        .ok_or_else(|| invalid("Invalid guest native command"))?;
    let binary = native
        .binary
        .to_str()
        .ok_or_else(|| invalid("Invalid guest native command"))?;
    if !valid(directory, id)
        || !absolute(workspace)
        || workspace.chars().any(char::is_control)
        || binary.is_empty()
        || !text(binary)
    {
        return Err(invalid("Invalid guest native command"));
    }
    let mut environment = vec![
        "HOME=/root".to_owned(),
        "LANG=C.UTF-8".to_owned(),
        format!("PATH={GUEST_PATH}"),
    ];
    for (key, value) in &native.environment {
        if let Some(key) = key.to_str().filter(|key| ENVIRONMENT_KEYS.contains(key))
            && let Some(value) = value
        {
            let value = value
                .to_str()
                .filter(|value| text(value))
                .ok_or_else(|| invalid("Invalid guest native environment"))?;
            environment.push(format!("{key}={value}"));
        }
    }
    let provider = native
        .environment
        .get(std::ffi::OsStr::new(PROVIDER_KEY))
        .and_then(|value| value.as_ref());
    let mut secret = None;
    let provider = if let Some(provider) = provider {
        let provider = provider
            .to_str()
            .filter(|value| {
                !value.is_empty()
                    && value.len() <= 128
                    && value.bytes().enumerate().all(|(index, value)| {
                        value.is_ascii_alphabetic()
                            || value == b'_'
                            || index > 0 && value.is_ascii_digit()
                    })
                    && !ENVIRONMENT_KEYS.contains(value)
                    && ![PROVIDER_KEY, PROVIDER_SECRET, "HOME", "LANG", "PATH"].contains(value)
            })
            .ok_or_else(|| {
                invalid("Invalid explicitly selected native provider environment key")
            })?;
        let value = native
            .environment
            .get(std::ffi::OsStr::new(provider))
            .and_then(|value| value.as_ref())
            .and_then(|value| value.to_str())
            .filter(|value| !value.trim().is_empty() && text(value) && value.len() <= 65536)
            .ok_or_else(|| {
                invalid("Invalid explicitly selected native provider environment key")
            })?;
        secret = Some(OsString::from(value));
        Some(provider)
    } else {
        None
    };
    let environment = environment
        .iter()
        .map(|value| quote(value))
        .collect::<Vec<_>>()
        .join(" ");
    let mut invocation = vec![binary.to_owned()];
    for argument in &native.arguments {
        invocation.push(
            argument
                .to_str()
                .filter(|value| text(value))
                .ok_or_else(|| invalid("Invalid guest native argument"))?
                .to_owned(),
        );
    }
    let remote = format!(
        "cd -- {} && exec /usr/bin/env -i -- {}{} {}",
        quote(workspace),
        environment,
        provider
            .map(|key| format!(
                " {}=\"${{{PROVIDER_SECRET}:?Missing selected native provider key}}\"",
                quote(key)
            ))
            .unwrap_or_default(),
        invocation
            .iter()
            .map(|value| quote(value))
            .collect::<Vec<_>>()
            .join(" ")
    );
    if !text(&remote) {
        return Err(invalid("Guest native command exceeds its byte bound"));
    }
    let mut arguments = multiplex(directory);
    if provider.is_some() {
        arguments.extend(["-o".into(), format!("SendEnv={PROVIDER_SECRET}").into()]);
    }
    arguments.extend([format!("root@{}", alias(id)).into(), remote.into()]);
    let mut placed = command(directory, arguments, native.input);
    placed.environment.insert(PROVIDER_SECRET.into(), secret);
    Ok(placed)
}
pub fn check(directory: &Path, id: &str) -> Result<NativeCommand> {
    if !valid(directory, id) {
        return Err(invalid("Invalid private VM SSH connection identity"));
    }
    let mut arguments = multiplex(directory);
    arguments.extend([
        "-O".into(),
        "check".into(),
        format!("root@{}", alias(id)).into(),
    ]);
    Ok(command(directory, arguments, false))
}

pub fn terminal(execution: &SshExecution, workspace: &Path, script: &str) -> Result<String> {
    let command = place(
        &execution.directory,
        &execution.id,
        &NativeCommand {
            binary: "/bin/sh".into(),
            arguments: vec!["-c".into(), script.into()],
            workspace: workspace.to_owned(),
            environment: BTreeMap::new(),
            input: true,
        },
    )?;
    let mut arguments = vec![quote("/usr/bin/ssh")];
    for argument in &command.arguments {
        let argument = argument
            .to_str()
            .ok_or_else(|| invalid("Invalid guest terminal argument"))?;
        arguments.push(quote(if argument == "-T" { "-tt" } else { argument }));
    }
    Ok(arguments.join(" "))
}
pub fn forward(
    directory: &Path,
    id: &str,
    local_port: u16,
    guest_port: u16,
) -> Result<NativeCommand> {
    if !valid(directory, id) || local_port == 0 || guest_port == 0 {
        return Err(invalid("Invalid guest endpoint forwarding request"));
    }
    let mut arguments = multiplex(directory);
    arguments.extend([
        "-O".into(),
        "forward".into(),
        "-o".into(),
        "ExitOnForwardFailure=yes".into(),
        "-L".into(),
        format!("127.0.0.1:{local_port}:127.0.0.1:{guest_port}").into(),
        format!("root@{}", alias(id)).into(),
    ]);
    Ok(command(directory, arguments, false))
}
