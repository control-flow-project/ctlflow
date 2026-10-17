use crossfire_adapter_process::{NativeCommand, NativeProcess, Output, capture};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
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
pub fn capture_timeout(args: &[String]) -> Duration {
    Duration::from_secs(
        if matches!(
            args.first().map(String::as_str),
            Some("create" | "stop" | "rm")
        ) {
            120
        } else {
            30
        },
    )
}
pub async fn captured(
    args: &[String],
    workspace: &Path,
    stop: CancellationToken,
) -> Result<Output> {
    capture(
        &command(args, workspace),
        65536,
        capture_timeout(args),
        stop,
    )
    .await
    .map_err(|error| {
        Failure::new(
            error.code,
            format!(
                "Docker {} failed: {}",
                args.first().map(String::as_str).unwrap_or("command"),
                error.message
            ),
        )
    })
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
            pump(output, tokio::io::stderr()),
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
        crate::container_lifecycle::names(directory)[1].clone(),
        "--label".into(),
        format!("org.crossfire.directory={directory}"),
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
