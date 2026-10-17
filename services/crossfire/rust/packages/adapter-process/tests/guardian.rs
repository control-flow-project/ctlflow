use crossfire_adapter_filesystem::{PrivateDirectory, lock::StateLock};
use crossfire_adapter_process::{NativeCommand, NativeProcess};
use std::{collections::BTreeMap, os::unix::fs::PermissionsExt, path::Path, time::Duration};
use tokio::io::{AsyncBufReadExt, BufReader};

#[tokio::test]
async fn guard_parent_fixture() -> std::result::Result<(), Box<dyn std::error::Error>> {
    let Some(directory) = std::env::var_os("CROSSFIRE_GUARD_PROOF_HOME") else {
        return Ok(());
    };
    let directory = Path::new(&directory);
    let command=NativeCommand{binary:"/bin/sh".into(),arguments:vec!["-c".into(),"printf '%s' $$ > \"$PROOF_DIRECTORY/native.pid\"; /bin/sh -c 'printf \"%s\" $$ > \"$PROOF_DIRECTORY/child.pid\"; printf \"native-ready\\n\"; exec cat' <&0 & wait".into()],workspace:directory.to_owned(),environment:BTreeMap::from([("PROOF_DIRECTORY".into(),Some(directory.as_os_str().to_owned()))]),input:true};
    let mut native = NativeProcess::guarded(&command, directory, "proof")?;
    let _input = native.input()?;
    let mut output = BufReader::new(native.output()?);
    let mut line = String::new();
    tokio::time::timeout(Duration::from_secs(5), output.read_line(&mut line)).await??;
    assert_eq!(line, "native-ready\n");
    println!("parent-ready");
    std::future::pending::<()>().await;
    Ok(())
}
fn exited(pid: &str) -> bool {
    match std::fs::read_to_string(format!("/proc/{pid}/stat")) {
        Err(error) => error.kind() == std::io::ErrorKind::NotFound,
        Ok(value) => value
            .rsplit_once(')')
            .is_some_and(|(_, value)| value.trim_start().starts_with('Z')),
    }
}
#[tokio::test]
async fn actual_sigkill_of_controller_retires_native_descendants_and_releases_the_exact_guard_lock()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::Builder::new()
        .permissions(std::fs::Permissions::from_mode(0o700))
        .tempdir()?;
    PrivateDirectory::open(directory.path(), false)?;
    let guard = directory.path().join("crossfire-native-guard");
    std::fs::copy(env!("CARGO_BIN_EXE_crossfire-native-guard"), &guard)?;
    std::fs::set_permissions(&guard, std::fs::Permissions::from_mode(0o755))?;
    let mut parent = tokio::process::Command::new(std::env::current_exe()?)
        .args(["--exact", "guard_parent_fixture", "--nocapture"])
        .env("CROSSFIRE_GUARD_PROOF_HOME", directory.path())
        .env("CROSSFIRE_NATIVE_GUARD", &guard)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::inherit())
        .kill_on_drop(true)
        .spawn()?;
    let mut output = BufReader::new(parent.stdout.take().ok_or("Parent output")?).lines();
    tokio::time::timeout(Duration::from_secs(10), async {
        while let Some(line) = output.next_line().await? {
            if line == "parent-ready" {
                return Ok::<(), Box<dyn std::error::Error>>(());
            }
        }
        Err("Parent did not prove native readiness".into())
    })
    .await??;
    parent.start_kill()?;
    parent.wait().await?;
    tokio::time::timeout(Duration::from_secs(10), async {
        let mut tick = tokio::time::interval(Duration::from_millis(10));
        loop {
            let native = std::fs::read_to_string(directory.path().join("native.pid"))?;
            let child = std::fs::read_to_string(directory.path().join("child.pid"))?;
            if exited(&native)
                && exited(&child)
                && StateLock::acquire(&directory.path().join("crossfire-native-process-proof"))
                    .is_ok()
            {
                return Ok::<(), Box<dyn std::error::Error>>(());
            }
            tick.tick().await;
        }
    })
    .await??;
    Ok(())
}
