use crossfire_adapter_filesystem::PrivateDirectory;
use crossfire_adapter_runtime::ownership;
use crossfire_kernel::failure::ErrorCode;
use std::{io::Write, path::Path, process::Stdio, time::Duration};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines},
    process::{Child, ChildStdout, Command},
};

type TestResult = std::result::Result<(), Box<dyn std::error::Error>>;
type ProbeOutput = Lines<BufReader<ChildStdout>>;

#[test]
fn ownership_is_outside_every_exported_tree() -> TestResult {
    let root = tempfile::tempdir()?;
    let workspace = root.path().join("workspace");
    let home = root.path().join("native");
    PrivateDirectory::open(&workspace, true)?;
    PrivateDirectory::open(&home, true)?;
    for unsafe_path in [
        &workspace,
        &workspace.join("control"),
        &home,
        &home.join("control"),
        Path::new("relative-control"),
        &root.path().join("other/../control"),
        &root.path().join("host-control/"),
        &root.path().join("host-control\\alias"),
    ] {
        assert!(
            ownership::acquire(unsafe_path, &workspace, &home).is_err(),
            "exported or relative ownership rejected"
        );
    }
    assert!(
        !workspace.join("control").exists(),
        "rejection creates no exported lease"
    );
    assert!(
        !home.join("control").exists(),
        "rejection creates no native-home lease"
    );
    let directory = root.path().join("host-control");
    assert!(
        ownership::acquire(&directory, Path::new("/"), &home).is_err(),
        "root workspace cannot hide host-only ownership"
    );
    let lease = ownership::acquire(&directory, &workspace, &home)?;
    assert!(
        ownership::acquire(&directory, &workspace, &home).is_err(),
        "one process cannot acquire two owners"
    );
    assert!(
        directory.join("owner.lock").is_file(),
        "lease is in host storage"
    );
    assert!(
        !home.join("owner.lock").exists(),
        "native storage carries no lease"
    );
    let link = root.path().join("linked-control");
    std::os::unix::fs::symlink(&directory, &link)?;
    assert!(
        ownership::acquire(&link, &workspace, &home).is_err(),
        "symlinked ownership rejected"
    );
    let shared = root.path().join("shared-control");
    PrivateDirectory::open(&shared, true)?;
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(&shared, std::fs::Permissions::from_mode(0o740))?;
    assert!(
        ownership::acquire(&shared, &workspace, &home).is_err(),
        "existing shared ownership rejected"
    );
    assert_ne!(
        std::fs::metadata(&shared)?.permissions().mode() & 0o040,
        0,
        "rejection preserves existing permissions"
    );
    drop(lease);
    let _successor = ownership::acquire(&directory, &workspace, &home)?;
    Ok(())
}

async fn start_probe(
    root: &Path,
) -> std::result::Result<(Child, String, ProbeOutput), Box<dyn std::error::Error>> {
    let mut child = Command::new(std::env::current_exe()?)
        .args([
            "--exact",
            "host_ownership_excludes_other_processes",
            "--nocapture",
            "--test-threads=1",
        ])
        .env("CTLFLOW_OWNERSHIP_TEST_PROBE", root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .kill_on_drop(true)
        .spawn()?;
    let mut output = BufReader::new(
        child
            .stdout
            .take()
            .ok_or("Missing ownership probe output")?,
    )
    .lines();
    let ready = tokio::time::timeout(Duration::from_secs(10), async {
        for _ in 0..16 {
            let line = output
                .next_line()
                .await?
                .ok_or_else(|| std::io::Error::other("Ownership probe exited before readiness"))?;
            if let Some(state) = line.strip_prefix("native-ownership:") {
                return Ok::<_, std::io::Error>(state.to_owned());
            }
        }
        Err(std::io::Error::other(
            "Ownership probe readiness exceeded its output bound",
        ))
    })
    .await??;
    // Keep the pipe open for the test harness's small final result after the
    // readiness marker; closing it early would make a healthy probe fail.
    Ok((child, ready, output))
}

#[tokio::test]
async fn host_ownership_excludes_other_processes() -> TestResult {
    // Re-enter this test in a fresh process to exercise actual kernel/SQLite
    // exclusion, without inheriting the parent's in-process owner registry.
    if let Some(root) = std::env::var_os("CTLFLOW_OWNERSHIP_TEST_PROBE") {
        let root = Path::new(&root);
        match ownership::acquire(
            &root.join("host-control"),
            &root.join("workspace"),
            &root.join("native"),
        ) {
            Ok(lease) => {
                println!("\nnative-ownership:owned");
                std::io::stdout().flush()?;
                let mut input = BufReader::new(tokio::io::stdin()).lines();
                tokio::time::timeout(Duration::from_secs(10), input.next_line()).await??;
                drop(lease);
            }
            Err(error) if error.code == ErrorCode::Conflict => {
                println!("\nnative-ownership:rejected");
            }
            Err(error) => return Err(error.into()),
        }
        return Ok(());
    }
    let root = tempfile::tempdir()?;
    let workspace = root.path().join("workspace");
    let home = root.path().join("native");
    PrivateDirectory::open(&workspace, true)?;
    PrivateDirectory::open(&home, true)?;
    let directory = root.path().join("host-control");
    {
        let _lease = ownership::acquire(&directory, &workspace, &home)?;
        let (mut child, status, _output) = start_probe(root.path()).await?;
        assert_eq!(
            status, "rejected",
            "separate host process cannot acquire the live lease"
        );
        assert!(
            tokio::time::timeout(Duration::from_secs(10), child.wait())
                .await??
                .success()
        );
    }
    let (mut child, status, _output) = start_probe(root.path()).await?;
    assert_eq!(status, "owned", "successor acquires a released lease");
    assert!(
        ownership::acquire(&directory, &workspace, &home).is_err(),
        "controller cannot overlap the successor"
    );
    let mut input = child.stdin.take().ok_or("Missing ownership probe input")?;
    input.write_all(b"close\n").await?;
    input.flush().await?;
    assert!(
        tokio::time::timeout(Duration::from_secs(10), child.wait())
            .await??
            .success()
    );
    let _restored = ownership::acquire(&directory, &workspace, &home)?;
    Ok(())
}
