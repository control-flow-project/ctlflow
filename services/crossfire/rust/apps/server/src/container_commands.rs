use crossfire_adapter_process::{NativeCommand, NativeProcess, Output, capture};
use crossfire_kernel::{Failure, Result, failure::ErrorCode, identity};
use std::{collections::BTreeMap, path::Path, time::Duration};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio_util::sync::CancellationToken;

fn failed(message: &str) -> Failure {
    Failure::new(ErrorCode::Unavailable, message)
}
fn command(arguments: &[String], workspace: &Path) -> NativeCommand {
    NativeCommand {
        binary: "docker".into(),
        arguments: arguments.iter().map(Into::into).collect(),
        workspace: workspace.to_owned(),
        environment: BTreeMap::new(),
        input: false,
    }
}
pub fn resources(parent: Option<&str>) -> Result<Vec<String>> {
    match parent {
        None => Ok(vec![]),
        Some(parent)
            if parent.ends_with(".slice")
                && (7..=187).contains(&parent.len())
                && parent.as_bytes()[0].is_ascii_alphanumeric()
                && parent
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || b"_.-".contains(&byte)) =>
        {
            Ok(vec!["--cgroup-parent".into(), parent.into()])
        }
        _ => Err(failed(
            "Cgroup parent must be an existing systemd slice unit",
        )),
    }
}
pub async fn captured(
    args: &[String],
    workspace: &Path,
    stop: CancellationToken,
) -> Result<Output> {
    capture(
        &command(args, workspace),
        65536,
        Duration::from_secs(30),
        stop,
    )
    .await
}
pub async fn image(tag: &str, workspace: &Path, stop: CancellationToken) -> Result<bool> {
    Ok(captured(
        &["image".into(), "inspect".into(), tag.into()],
        workspace,
        stop,
    )
    .await?
    .status
    .success())
}
async fn pump(
    mut input: impl tokio::io::AsyncRead + Unpin,
    mut output: impl tokio::io::AsyncWrite + Unpin,
) -> Result<()> {
    let mut bytes = [0; 16384];
    loop {
        let count = input
            .read(&mut bytes)
            .await
            .map_err(|_| failed("Docker output failed"))?;
        if count == 0 {
            return Ok(());
        }
        output
            .write_all(&bytes[..count])
            .await
            .map_err(|_| failed("Operator output failed"))?;
    }
}
pub async fn run(args: &[String], workspace: &Path, stop: CancellationToken) -> Result<()> {
    if stop.is_cancelled() {
        return Err(failed("Docker operation cancelled"));
    }
    let mut process = NativeProcess::start(&command(args, workspace))?;
    let output = process.output()?;
    let errors = process.errors()?;
    let streams = async {
        tokio::try_join!(
            pump(output, tokio::io::stdout()),
            pump(errors, tokio::io::stderr())
        )
        .map(|_| ())
    };
    let operation = async {
        let (status, ()) = tokio::try_join!(process.wait(), streams)?;
        if status.success() {
            Ok(())
        } else {
            Err(failed("Docker command failed"))
        }
    };
    let result = tokio::select! {biased;_=stop.cancelled()=>Err(failed("Docker operation cancelled")),result=operation=>result};
    if result.is_err() {
        process.stop().await?;
    }
    result
}
fn mount(directory: &str) -> String {
    format!(
        "type=bind,\"source={}\",target=/runtime",
        directory.replace('"', "\"\"")
    )
}
pub fn migration(directory: &str, image: &str, resources: &[String]) -> Vec<String> {
    let mut args = vec![
        "run".into(),
        "--name".into(),
        format!("crossfire-migration-{}", &identity::hash(directory)[..16]),
        "--mount".into(),
        mount(directory),
    ];
    args.extend_from_slice(resources);
    args.extend(
        [
            "--network",
            "none",
            "--read-only",
            "--tmpfs",
            "/tmp:rw,nosuid,nodev,size=128m",
            "--cap-drop",
            "ALL",
            "--security-opt",
            "no-new-privileges",
            image,
        ]
        .map(Into::into),
    );
    args
}
pub fn server(
    directory: &str,
    image: &str,
    name: &str,
    port: u16,
    content: u16,
    resources: &[String],
) -> Vec<String> {
    let mut args = vec![
        "run".into(),
        "--name".into(),
        name.into(),
        "--label".into(),
        format!("org.crossfire.directory={directory}"),
        "--publish".into(),
        format!("127.0.0.1:{port}:8080"),
        "--publish".into(),
        format!("127.0.0.1:{content}:8082"),
        "--mount".into(),
        mount(directory),
    ];
    args.extend_from_slice(resources);
    args.extend(
        [
            "--read-only",
            "--tmpfs",
            "/tmp:rw,nosuid,nodev,size=128m",
            "--cap-drop",
            "ALL",
            "--security-opt",
            "no-new-privileges",
            image,
        ]
        .map(Into::into),
    );
    args
}
pub async fn owned(arguments: &[String], workspace: &Path, stop: CancellationToken) -> Result<()> {
    if arguments.first().map(String::as_str) != Some("run")
        || arguments
            .iter()
            .any(|arg| arg == "--rm" || arg.starts_with("--rm="))
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
    let created = captured(&create, workspace, CancellationToken::new()).await?;
    if !created.status.success() {
        return Err(failed(&format!(
            "Cannot create owned container: {}",
            created.errors
        )));
    }
    let id = created.output.trim();
    if id.len() != 64
        || !id
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(failed("Docker did not return an exact container identity"));
    }
    let attach = CancellationToken::new();
    let started = ["start".into(), "--attach".into(), id.into()];
    let running = run(&started, workspace, attach.clone());
    tokio::pin!(running);
    let cancelled = stop.cancelled();
    tokio::pin!(cancelled);
    let result = tokio::select! {biased;
        result=&mut running=>result,
        _=&mut cancelled=>{
            let stopped=captured(&["stop".into(),"--timeout".into(),"15".into(),id.into()],workspace,CancellationToken::new()).await;
            attach.cancel(); let ended=running.await;
            stopped.and_then(|value| if value.status.success(){Ok(())}else{Err(failed("Owned container stop failed"))}).and(ended.or_else(|error|if stop.is_cancelled(){Ok(())}else{Err(error)}))
        }
    };
    attach.cancel();
    let removed = captured(
        &["rm".into(), "--force".into(), id.into()],
        workspace,
        CancellationToken::new(),
    )
    .await?;
    if !removed.status.success() {
        let remaining = captured(
            &[
                "container".into(),
                "ls".into(),
                "--all".into(),
                "--no-trunc".into(),
                "--filter".into(),
                format!("id={id}"),
                "--format".into(),
                "{{.ID}}".into(),
            ],
            workspace,
            CancellationToken::new(),
        )
        .await?;
        if !remaining.status.success() || !remaining.output.trim().is_empty() {
            return Err(failed("Exact owned container cleanup is not confirmed"));
        }
    }
    result
}
