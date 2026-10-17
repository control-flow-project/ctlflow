use crossfire_adapter_filesystem::socket::{Ownership, Socket};
use crossfire_adapter_process::{NativeCommand, NativeProcess, collect};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use std::{
    collections::BTreeMap,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
    time::Duration,
};
use tempfile::TempDir;
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;
mod authentication;

pub fn valid_host(value: &str) -> bool {
    let parts = value.split('@').collect::<Vec<_>>();
    (1..=2).contains(&parts.len())
        && parts.iter().all(|part| {
            !part.is_empty()
                && part.as_bytes()[0].is_ascii_alphanumeric()
                && part
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || b"_.-".contains(&byte))
        })
}
pub fn valid_root(value: &str) -> bool {
    value.starts_with('/')
        && !value.contains(':')
        && !value.chars().any(char::is_control)
        && Path::new(value)
            .components()
            .collect::<PathBuf>()
            .as_os_str()
            == value
}
pub fn quote(value: &str) -> String {
    "'".to_owned() + &value.replace('\'', "'\\''") + "'"
}
pub fn terminal(host: &str, command: &str) -> Result<String> {
    if !valid_host(host) {
        return Err(invalid());
    }
    Ok([
        "ssh",
        "-t",
        "-o",
        "StrictHostKeyChecking=yes",
        host,
        command,
    ]
    .into_iter()
    .map(quote)
    .collect::<Vec<_>>()
    .join(" "))
}
fn invalid() -> Failure {
    Failure::new(
        ErrorCode::Invalid,
        "Use a configured SSH hostname and absolute remote Unix root without colon or control characters",
    )
}
pub struct Tunnel {
    authentication_key: crossfire_kernel::secret::Secret,
    directory: TempDir,
    process: NativeProcess,
    socket: Option<Ownership>,
    output: Option<JoinHandle<Result<String>>>,
    errors: Option<JoinHandle<Result<String>>>,
    stop: CancellationToken,
}
impl Tunnel {
    pub fn authentication_key(&self) -> crossfire_kernel::secret::Secret {
        self.authentication_key.clone()
    }
    pub fn socket(&self) -> PathBuf {
        self.directory.path().join("daemon.sock")
    }
    pub async fn open(host: &str, root: &str, stop: CancellationToken) -> Result<Self> {
        if !valid_host(host) || !valid_root(root) {
            return Err(invalid());
        }
        let authentication_key = authentication::read(host, stop.clone()).await?;
        let directory = tempfile::Builder::new()
            .prefix("fleet-ssh-")
            .permissions(std::fs::Permissions::from_mode(0o700))
            .tempdir()
            .map_err(|_| {
                Failure::new(
                    ErrorCode::Unavailable,
                    "Cannot create private SSH forwarding state",
                )
            })?;
        let forward = format!("./daemon.sock:{root}/fleetd.sock");
        let mut process = NativeProcess::start(&NativeCommand {
            binary: "ssh".into(),
            arguments: [
                "-N",
                "-T",
                "-o",
                "BatchMode=yes",
                "-o",
                "ExitOnForwardFailure=yes",
                "-o",
                "StrictHostKeyChecking=yes",
                "-o",
                "StreamLocalBindUnlink=no",
                "-L",
                &forward,
                host,
            ]
            .into_iter()
            .map(Into::into)
            .collect(),
            workspace: directory.path().to_owned(),
            environment: BTreeMap::new(),
            input: false,
        })?;
        let output = process.output()?;
        let errors = process.errors()?;
        let capture = stop.child_token();
        let first = capture.clone();
        let second = capture.clone();
        let mut tunnel = Self {
            authentication_key,
            directory,
            process,
            socket: None,
            output: Some(tokio::spawn(
                async move { collect(output, 65536, first).await },
            )),
            errors: Some(tokio::spawn(
                async move { collect(errors, 65536, second).await },
            )),
            stop: capture,
        };
        let ready = async {
            let mut tick = tokio::time::interval(Duration::from_millis(50));
            loop {
                if std::fs::symlink_metadata(tunnel.socket()).is_ok() {
                    let socket = Socket::prepare(&tunnel.socket())?;
                    socket.protect()?;
                    tunnel.socket = Some(socket.claim()?);
                    return Ok(());
                }
                tokio::select! { biased; _=stop.cancelled()=>return Err(Failure::new(ErrorCode::Unavailable,"SSH forwarding was cancelled")),result=tunnel.process.wait()=>{result?;return Err(Failure::new(ErrorCode::Unavailable,"SSH ended before its private socket was ready"))},_=tick.tick()=>{} }
            }
        };
        match tokio::time::timeout(Duration::from_secs(120), ready).await {
            Ok(Ok(())) => Ok(tunnel),
            result => {
                let error = match result {
                    Ok(Err(error)) => error,
                    _ => Failure::new(
                        ErrorCode::Unavailable,
                        "SSH forwarding exceeded its startup deadline",
                    ),
                };
                tunnel.close().await?;
                Err(error)
            }
        }
    }
    pub async fn close(&mut self) -> Result<()> {
        self.process.stop().await?;
        self.stop.cancel();
        for task in [&mut self.output, &mut self.errors] {
            if let Some(task) = task.take() {
                let _collected = task.await.map_err(|_| {
                    Failure::new(ErrorCode::Unavailable, "SSH stream collection failed")
                })?;
            }
        }
        if let Some(socket) = self.socket.take() {
            socket.remove()?
        }
        Ok(())
    }
}
