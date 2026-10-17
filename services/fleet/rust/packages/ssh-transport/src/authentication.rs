use crossfire_adapter_process::{NativeCommand, capture};
use crossfire_kernel::{Failure, Result, failure::ErrorCode, secret::Secret};
use std::{collections::BTreeMap, time::Duration};
use tokio_util::sync::CancellationToken;

pub async fn read(host: &str, stop: CancellationToken) -> Result<Secret> {
    if !super::valid_host(host) {
        return Err(failure());
    }
    let asset: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../node/packages/ssh-transport/assets/authentication.json"
    ))
    .map_err(|_| failure())?;
    let script = asset["script"].as_str().ok_or_else(failure)?;
    let result = capture(
        &NativeCommand {
            binary: "ssh".into(),
            arguments: [
                "-T".to_owned(),
                "-o".to_owned(),
                "StrictHostKeyChecking=yes".to_owned(),
                host.to_owned(),
                "sh -c ".to_owned() + &super::quote(script),
            ]
            .into_iter()
            .map(Into::into)
            .collect(),
            workspace: std::env::current_dir().map_err(|_| failure())?,
            environment: BTreeMap::new(),
            input: false,
        },
        4096,
        Duration::from_secs(15),
        stop,
    )
    .await
    .map_err(|_| failure())?;
    if !result.status.success() {
        return Err(failure());
    }
    fleetd_storage::authentication::decode(result.output.as_bytes())
        .map_err(|_| failure())?
        .ok_or_else(failure)
}

fn failure() -> Failure {
    Failure::new(
        ErrorCode::Unauthorized,
        "Cannot read remote fleetd authentication through trusted SSH",
    )
}
