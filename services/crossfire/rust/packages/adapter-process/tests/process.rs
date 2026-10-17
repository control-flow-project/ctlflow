use crossfire_adapter_process::{NativeCommand, NativeProcess, capture};
use std::{collections::BTreeMap, ffi::OsString, time::Duration};
use tokio::{
    io::{AsyncBufReadExt, BufReader},
    sync::oneshot,
};
use tokio_util::sync::CancellationToken;

fn command(directory: &std::path::Path, script: &str) -> NativeCommand {
    NativeCommand {
        binary: OsString::from("/bin/sh"),
        arguments: ["-c", script].into_iter().map(OsString::from).collect(),
        workspace: directory.to_owned(),
        environment: BTreeMap::new(),
        input: false,
    }
}

#[tokio::test]
async fn actual_native_command_has_one_process_group_and_exact_environment()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let mut command = command(
        directory.path(),
        "printf '%s' \"$CROSSFIRE_NATIVE_TEST\"; printf 'diagnostic' >&2; exit 7",
    );
    command.environment.insert(
        OsString::from("CROSSFIRE_NATIVE_TEST"),
        Some(OsString::from("value with spaces; not a command")),
    );
    let output = capture(
        &command,
        4096,
        Duration::from_secs(2),
        CancellationToken::new(),
    )
    .await?;
    assert_eq!(output.output, "value with spaces; not a command");
    assert_eq!(output.errors, "diagnostic");
    assert_eq!(output.status.code(), Some(7));
    let mut owned = NativeProcess::start(&command)?;
    let pid =
        rustix::process::Pid::from_raw(i32::try_from(owned.id())?).ok_or("Native identity")?;
    assert_eq!(rustix::process::getpgid(Some(pid))?, pid);
    owned.stop().await?;
    owned.stop().await?;
    Ok(())
}

#[tokio::test]
async fn output_limits_and_bad_unicode_fail_without_leaving_a_native_process()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    for script in [
        "while :; do printf 'too-much-output'; done",
        "printf '\\377'",
    ] {
        assert!(
            capture(
                &command(directory.path(), script),
                100,
                Duration::from_secs(2),
                CancellationToken::new()
            )
            .await
            .is_err()
        );
    }
    let cancelled = CancellationToken::new();
    cancelled.cancel();
    assert!(
        capture(
            &command(directory.path(), "exit 0"),
            100,
            Duration::from_secs(2),
            cancelled
        )
        .await
        .is_err()
    );
    let mut invalid = command(directory.path(), "exit 0");
    invalid.arguments.push(OsString::from("bad\0argument"));
    assert!(NativeProcess::start(&invalid).is_err());
    Ok(())
}

#[tokio::test]
async fn cancellation_terminates_the_group_after_observed_readiness()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let mut configuration = command(directory.path(), "printf 'ready\\n'; exec cat");
    configuration.input = true;
    let mut owned = NativeProcess::start(&configuration)?;
    let pid =
        rustix::process::Pid::from_raw(i32::try_from(owned.id())?).ok_or("Native identity")?;
    let mut output = BufReader::new(owned.output()?);
    let mut line = String::new();
    tokio::time::timeout(Duration::from_secs(2), output.read_line(&mut line)).await??;
    assert_eq!(line, "ready\n");
    owned.stop().await?;
    assert!(
        rustix::process::getpgid(Some(pid)).is_err(),
        "Owned process group ended"
    );
    let (ready, received) = oneshot::channel();
    let cancellation = CancellationToken::new();
    let trigger = cancellation.clone();
    let operation = command(directory.path(), "read ignored");
    let task = tokio::spawn(async move {
        let _notified = ready.send(());
        capture(&operation, 100, Duration::from_secs(2), trigger).await
    });
    received.await?;
    cancellation.cancel();
    assert!(task.await?.is_err());
    Ok(())
}
