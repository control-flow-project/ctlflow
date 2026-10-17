use crate::{arguments::invalid, connections};
use crossfire_adapter_filesystem::{PrivateDirectory, lock::StateLock, owned::OwnedFile};
use crossfire_contracts::call::Call;
use crossfire_kernel::{Failure, Result, failure::ErrorCode, identity};
use fleet_daemon_client::Client;
use fleetd_contracts::operations::OperationId;
use serde_json::{Value, json};
use std::{
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};
use tokio::process::Command;
use tokio_util::sync::CancellationToken;

pub fn release_directory() -> Result<PathBuf> {
    Ok(executable()?
        .parent()
        .ok_or_else(|| invalid("CLI executable has no distribution parent"))?
        .parent()
        .ok_or_else(|| invalid("CLI distribution is incomplete"))?
        .join("fleetd/artifacts"))
}
fn executable() -> Result<PathBuf> {
    std::env::current_exe().map_err(|_| invalid("CLI executable location unavailable"))
}
fn daemon() -> Result<PathBuf> {
    Ok(executable()?
        .parent()
        .ok_or_else(|| invalid("CLI distribution is incomplete"))?
        .parent()
        .ok_or_else(|| invalid("CLI distribution is incomplete"))?
        .join("fleetd/fleetd"))
}
pub fn stop_request() -> Value {
    json!({"operationId":identity::id(),"action":"stop","target":{"kind":"daemon"},"expectedRevision":0})
}
pub async fn probe(root: &Path, stop: CancellationToken) -> Result<Option<Value>> {
    match std::fs::symlink_metadata(root.join("fleetd.sock")) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(invalid("Cannot inspect controller endpoint")),
        Ok(_) => {}
    }
    let client = Client::open(&root.join("fleetd.sock"), stop.clone())?;
    match client.call(&Call::new(OperationId::Status), stop).await {
        Ok(value) => Ok(Some(value)),
        Err(error) if error.code == ErrorCode::Unavailable => Ok(None),
        Err(error) => Err(error),
    }
}
fn validate(value: &Value, name: Option<&str>) -> Result<()> {
    if value["stopping"] != false
        || name.is_some_and(|name| value["controller"]["name"].as_str() != Some(name))
    {
        return Err(invalid(
            "Selected controller has another identity or is stopping",
        ));
    }
    Ok(())
}
pub async fn launch(root: &Path, name: Option<&str>, stop: CancellationToken) -> Result<Value> {
    if !root.is_absolute() || connections::absolute(connections::text(root)?)? != root {
        return Err(invalid("Use an absolute normalized controller root"));
    }
    PrivateDirectory::open(root, true)?;
    let deadline = tokio::time::Instant::now() + Duration::from_secs(65);
    let _ownership = loop {
        match StateLock::acquire(&root.join("launcher")) {
            Ok(lock) => break lock,
            Err(error) if error.code == ErrorCode::Conflict => {
                wait(stop.clone(), deadline, Duration::from_millis(100)).await?
            }
            Err(error) => return Err(error),
        }
    };
    if let Some(value) = probe(root, stop.clone()).await? {
        validate(&value, name)?;
        return Ok(value);
    }
    let binary = daemon()?;
    let file = OwnedFile::open(&binary, 268435456)?
        .ok_or_else(|| invalid("The installed native fleetd executable is missing"))?;
    file.configuration_permissions()?;
    use std::os::unix::fs::PermissionsExt;
    if std::fs::metadata(&binary)
        .map_err(|_| invalid("Cannot inspect fleetd executable"))?
        .permissions()
        .mode()
        & 0o111
        == 0
    {
        return Err(invalid("Installed fleetd is not executable"));
    }
    let mut command = Command::new("/usr/bin/setsid");
    command
        .arg("--")
        .arg(binary)
        .arg("--root")
        .arg(root)
        .arg("--artifacts")
        .arg(release_directory()?)
        .arg("--background")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .current_dir(root);
    if let Some(name) = name {
        command.arg("--name").arg(name);
    }
    let mut child = command.spawn().map_err(|_| {
        Failure::new(
            ErrorCode::Unavailable,
            "Cannot start the installed native controller",
        )
    })?;
    let result = async {
        loop {
            if let Some(value) = probe(root, stop.clone()).await? {
                validate(&value, name)?;
                return Ok(value);
            }
            if child
                .try_wait()
                .map_err(|_| invalid("Cannot inspect controller launch"))?
                .is_some()
            {
                return Err(Failure::new(
                    ErrorCode::Unavailable,
                    "Controller did not become ready; inspect its private logs",
                ));
            }
            wait(stop.clone(), deadline, Duration::from_millis(100)).await?;
        }
    }
    .await;
    if result.is_err() {
        if let Some(pid) = child
            .id()
            .and_then(|pid| i32::try_from(pid).ok())
            .and_then(rustix::process::Pid::from_raw)
        {
            let _terminated =
                rustix::process::kill_process_group(pid, rustix::process::Signal::TERM);
        }
        if tokio::time::timeout(Duration::from_secs(3), child.wait())
            .await
            .is_err()
        {
            child
                .start_kill()
                .map_err(|_| invalid("Cannot stop failed controller launch"))?;
            tokio::time::timeout(Duration::from_secs(5), child.wait())
                .await
                .map_err(|_| invalid("Controller launch did not stop"))?
                .map_err(|_| invalid("Cannot reap failed controller launch"))?;
        }
    }
    result
}
pub async fn wait(
    stop: CancellationToken,
    deadline: tokio::time::Instant,
    duration: Duration,
) -> Result<()> {
    tokio::select! {biased;_=stop.cancelled()=>Err(Failure::new(ErrorCode::Unavailable,"CLI disconnected; accepted operations continue in fleetd")),_=tokio::time::sleep_until(deadline)=>Err(Failure::new(ErrorCode::Unavailable,"Controller observation exceeded its deadline")),_=tokio::time::sleep(duration)=>Ok(())}
}
pub async fn restart(root: &Path, stop: CancellationToken) -> Result<Value> {
    let client = Client::open(&root.join("fleetd.sock"), stop.clone())?;
    let previous = client
        .call(&Call::new(OperationId::Status), stop.clone())
        .await?;
    let mut call = Call::new(OperationId::Operate);
    call.body = Some(stop_request());
    client.call(&call, stop.clone()).await?;
    let deadline = tokio::time::Instant::now() + Duration::from_secs(65);
    while probe(root, stop.clone()).await?.is_some() {
        wait(stop.clone(), deadline, Duration::from_millis(100)).await?;
    }
    launch(root, previous["controller"]["name"].as_str(), stop).await
}
