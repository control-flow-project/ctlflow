use crate::container_commands as docker;
use crossfire_kernel::{Failure, Result, failure::ErrorCode, identity};
use serde_json::Value;
use std::path::Path;
use tokio_util::sync::CancellationToken;

fn failed(message: &str) -> Failure {
    Failure::new(ErrorCode::Unavailable, message)
}
fn exact(identity: &str) -> bool {
    identity.len() == 64
        && identity
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}
pub fn names(directory: &str) -> [String; 2] {
    let digest = identity::hash(directory);
    [
        format!("crossfire-{}", &digest[..16]),
        format!("crossfire-migration-{}", &digest[..16]),
    ]
}
async fn identities(
    filter: &str,
    workspace: &Path,
    stop: CancellationToken,
) -> Result<Vec<String>> {
    let result = docker::captured(
        &[
            "container".into(),
            "ls".into(),
            "--all".into(),
            "--no-trunc".into(),
            "--filter".into(),
            filter.into(),
            "--format".into(),
            "{{.ID}}".into(),
        ],
        workspace,
        stop,
    )
    .await?;
    if !result.status.success() {
        return Err(failed("Cannot establish existing container ownership"));
    }
    let output: Vec<_> = result.output.trim().lines().map(str::to_owned).collect();
    if output.iter().any(|value| !exact(value)) {
        return Err(failed("Docker returned an invalid container identity"));
    }
    Ok(output)
}
async fn state(
    identity: &str,
    workspace: &Path,
    stop: CancellationToken,
) -> Result<Option<String>> {
    let filter = format!("id={identity}");
    if identities(&filter, workspace, stop.clone())
        .await?
        .is_empty()
    {
        return Ok(None);
    }
    let inspected = docker::captured(
        &[
            "container".into(),
            "inspect".into(),
            "--format".into(),
            "{{.State.Status}}".into(),
            identity.into(),
        ],
        workspace,
        stop.clone(),
    )
    .await?;
    if !inspected.status.success() {
        if identities(&filter, workspace, stop).await?.is_empty() {
            return Ok(None);
        }
        return Err(failed("Cannot establish owned container state"));
    }
    let value = inspected.output.trim();
    if ![
        "created",
        "running",
        "paused",
        "restarting",
        "removing",
        "exited",
        "dead",
    ]
    .contains(&value)
    {
        return Err(failed("Docker returned an invalid owned container state"));
    }
    Ok(Some(value.into()))
}
async fn remove_observed(identity: &str, workspace: &Path, stop: CancellationToken) -> Result<()> {
    let Some(mut current) = state(identity, workspace, stop.clone()).await? else {
        return Ok(());
    };
    if current != "removing" {
        let stopped = docker::captured(
            &[
                "stop".into(),
                "--timeout".into(),
                "15".into(),
                identity.into(),
            ],
            workspace,
            stop.clone(),
        )
        .await?;
        let Some(next) = state(identity, workspace, stop.clone()).await? else {
            return Ok(());
        };
        current = next;
        if !stopped.status.success()
            && !["created", "exited", "dead", "removing"].contains(&current.as_str())
        {
            return Err(failed(&format!(
                "Owned container stop is not confirmed: {}",
                stopped.errors
            )));
        }
        if current != "removing" {
            let removed =
                docker::captured(&["rm".into(), identity.into()], workspace, stop.clone()).await;
            let Some(next) = state(identity, workspace, stop.clone()).await? else {
                return Ok(());
            };
            current = next;
            if current != "removing" {
                match removed {
                    Ok(value) if value.status.success() => {}
                    Ok(value) => {
                        return Err(failed(&format!(
                            "Owned container cleanup is not confirmed: {}",
                            value.errors
                        )));
                    }
                    Err(error) => return Err(error),
                }
            }
        }
    }
    loop {
        tokio::select! { biased;
            _ = stop.cancelled() => return Err(failed("Owned container cleanup cancelled")),
            _ = tokio::time::sleep(std::time::Duration::from_millis(25)) => {},
        }
        if state(identity, workspace, stop.clone()).await?.is_none() {
            return Ok(());
        }
    }
}
pub async fn remove(identity: &str, workspace: &Path, stop: CancellationToken) -> Result<()> {
    if !exact(identity) {
        return Err(failed("Cleanup requires an exact container identity"));
    }
    tokio::time::timeout(
        std::time::Duration::from_secs(120),
        remove_observed(identity, workspace, stop),
    )
    .await
    .map_err(|_| failed("Owned container cleanup deadline exceeded"))?
}
pub async fn reconcile(directory: &str, workspace: &Path, stop: CancellationToken) -> Result<()> {
    let mut owned = Vec::new();
    for name in names(directory) {
        let found = identities(&format!("name=^/{name}$"), workspace, stop.clone()).await?;
        if found.len() > 1 {
            return Err(failed(
                "Docker returned ambiguous instance container ownership",
            ));
        }
        for identity in found {
            let inspection = docker::captured(
                &[
                    "container".into(),
                    "inspect".into(),
                    "--format".into(),
                    "{{.Id}}\n{{json .Config.Labels}}".into(),
                    identity.clone(),
                ],
                workspace,
                stop.clone(),
            )
            .await?;
            if !inspection.status.success() {
                return Err(failed("Cannot verify existing container ownership"));
            }
            let mut lines = inspection.output.trim().lines();
            let actual = lines.next();
            let labels = lines
                .next()
                .and_then(|value| serde_json::from_str::<Value>(value).ok());
            if actual != Some(identity.as_str())
                || lines.next().is_some()
                || labels
                    .as_ref()
                    .and_then(|value| value.get("org.crossfire.directory"))
                    .and_then(Value::as_str)
                    != Some(directory)
            {
                return Err(failed(
                    "Existing container has different ownership; nothing was stopped",
                ));
            }
            owned.push(identity);
        }
    }
    for identity in owned {
        remove(&identity, workspace, stop.clone()).await?;
    }
    Ok(())
}
pub async fn owned(arguments: &[String], workspace: &Path, stop: CancellationToken) -> Result<()> {
    if arguments.first().map(String::as_str) != Some("run")
        || !arguments.iter().any(|value| value == "--name")
        || arguments
            .iter()
            .any(|value| value == "--rm" || value.starts_with("--rm="))
    {
        return Err(failed(
            "Use explicit owned container lifecycle without automatic removal",
        ));
    }
    if stop.is_cancelled() {
        return Err(failed("Container startup cancelled"));
    }
    let mut create = vec!["create".into()];
    create.extend_from_slice(&arguments[1..]);
    let created = docker::captured(&create, workspace, CancellationToken::new()).await?;
    if !created.status.success() {
        return Err(failed("Cannot create owned container"));
    }
    let identity = created.output.trim();
    if !exact(identity) {
        return Err(failed("Docker did not return an exact container identity"));
    }
    let attach = CancellationToken::new();
    let result = if stop.is_cancelled() {
        Ok(())
    } else {
        let arguments = ["start".into(), "--attach".into(), identity.into()];
        let running = docker::run(&arguments, workspace, attach.clone());
        tokio::pin!(running);
        tokio::select! { biased;
            result = &mut running => result,
            _ = stop.cancelled() => {
                let stopped = docker::captured(&["stop".into(), "--timeout".into(), "15".into(), identity.into()], workspace, CancellationToken::new()).await;
                attach.cancel(); let _ended = running.await;
                stopped.and_then(|value| if value.status.success() { Ok(()) } else { Err(failed("Owned container stop is not confirmed")) })
            }
        }
    };
    attach.cancel();
    remove(identity, workspace, CancellationToken::new())
        .await
        .map_err(|error| {
            failed(&format!(
                "Owned container cleanup is not confirmed: {}",
                error.message
            ))
        })?;
    result
}
