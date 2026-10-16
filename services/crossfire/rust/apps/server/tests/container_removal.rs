use crossfire_server::container_lifecycle;
use std::{os::unix::fs::PermissionsExt, path::Path, process::Command};
use tokio_util::sync::CancellationToken;

#[tokio::test]
async fn removal_observes_exact_absence_without_competing_with_an_existing_removal()
-> Result<(), Box<dyn std::error::Error>> {
    if let Some(root) = std::env::var_os("CROSSFIRE_REMOVAL_FIXTURE") {
        let root = Path::new(&root);
        let identity = "a".repeat(64);
        let mode = std::env::var("FIXTURE_MODE")?;
        let stop = CancellationToken::new();
        if mode == "cancelled" {
            stop.cancel();
        }
        if mode == "stuck" {
            let removing = container_lifecycle::remove(&identity, root, stop.clone());
            tokio::pin!(removing);
            let observed = async {
                let mut tick = tokio::time::interval(std::time::Duration::from_millis(5));
                loop {
                    tick.tick().await;
                    if std::fs::read_to_string(root.join("calls"))?
                        .lines()
                        .filter(|line| line.starts_with("container inspect"))
                        .count()
                        >= 2
                    {
                        stop.cancel();
                        return Ok::<_, std::io::Error>(());
                    }
                }
            };
            let cancelled = tokio::time::timeout(std::time::Duration::from_secs(5), async {
                tokio::select! {
                    result = &mut removing => { result?; Err::<(), Box<dyn std::error::Error>>("an existing removal cannot be reported complete".into()) },
                    result = observed => { result?; assert!(removing.await.is_err()); Ok(()) },
                }
            }).await?;
            return cancelled;
        }
        let result = container_lifecycle::remove(&identity, root, stop).await;
        if mode == "denied" {
            assert!(result.is_err_and(|error| error.message.contains("permission denied")));
        } else if mode == "invalid-state" || mode == "cancelled" {
            assert!(result.is_err());
        } else {
            result?;
        }
        return Ok(());
    }
    let temporary = tempfile::tempdir()?;
    let root = temporary.path();
    std::fs::write(
        root.join("docker"),
        r##"#!/bin/sh
phase=$(/bin/cat "$CROSSFIRE_REMOVAL_FIXTURE/state")
printf '%s\n' "$*" >> "$CROSSFIRE_REMOVAL_FIXTURE/calls"
case "$1 $2" in
  'stop --timeout') phase=exited ;;
  'rm aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
    if [ "$FIXTURE_MODE" = denied ]; then echo 'permission denied' >&2; exit 1; fi
    phase=removing
    printf '%s' "$phase" > "$CROSSFIRE_REMOVAL_FIXTURE/state"
    if [ "$FIXTURE_MODE" = in-progress ]; then exit 1; fi ;;
  'container ls')
    if [ "$phase" = removing ] && [ "$FIXTURE_MODE" != stuck ]; then
      count=$(/bin/cat "$CROSSFIRE_REMOVAL_FIXTURE/observations"); count=$((count + 1))
      printf '%s' "$count" > "$CROSSFIRE_REMOVAL_FIXTURE/observations"
      if [ "$count" -gt 2 ]; then phase=missing; fi
    fi
    if [ "$phase" != missing ]; then printf '%s\n' aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa; fi ;;
  'container inspect') printf '%s\n' "$phase" ;;
  *) exit 1 ;;
esac
printf '%s' "$phase" > "$CROSSFIRE_REMOVAL_FIXTURE/state"
"##,
    )?;
    std::fs::set_permissions(root.join("docker"), std::fs::Permissions::from_mode(0o700))?;
    for phase in ["missing", "removing", "running"] {
        for mode in ["normal", "in-progress"] {
            std::fs::write(root.join("state"), phase)?;
            std::fs::write(root.join("observations"), "0")?;
            std::fs::write(root.join("calls"), "")?;
            let result = run(root, mode)?;
            assert!(
                result.status.success(),
                "{}",
                String::from_utf8(result.stdout)?
            );
            let calls = std::fs::read_to_string(root.join("calls"))?;
            assert_eq!(
                calls.lines().filter(|line| line.starts_with("rm ")).count(),
                usize::from(phase == "running")
            );
            assert_eq!(
                calls
                    .lines()
                    .filter(|line| line.starts_with("stop "))
                    .count(),
                usize::from(phase == "running")
            );
            assert_eq!(std::fs::read_to_string(root.join("state"))?, "missing");
        }
    }
    for (phase, mode) in [
        ("removing", "stuck"),
        ("running", "denied"),
        ("invalid", "invalid-state"),
        ("running", "cancelled"),
    ] {
        std::fs::write(root.join("state"), phase)?;
        std::fs::write(root.join("observations"), "0")?;
        std::fs::write(root.join("calls"), "")?;
        assert!(run(root, mode)?.status.success(), "explicit {mode} failure");
    }
    Ok(())
}
fn run(root: &Path, mode: &str) -> Result<std::process::Output, Box<dyn std::error::Error>> {
    Ok(Command::new(std::env::current_exe()?)
        .args([
            "--exact",
            "removal_observes_exact_absence_without_competing_with_an_existing_removal",
            "--nocapture",
        ])
        .env("CROSSFIRE_REMOVAL_FIXTURE", root)
        .env("FIXTURE_MODE", mode)
        .env("PATH", format!("{}:/usr/bin:/bin", root.display()))
        .output()?)
}
