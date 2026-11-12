use crossfire_adapter_process::{NativeCommand, capture};
use fleetd_adapter_execution::vm::images;
use fleetd_domain::execution::Image;
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, os::unix::fs::PermissionsExt, path::Path, time::Duration};
use tokio_util::sync::CancellationToken;

async fn create(
    root: &Path,
    name: &str,
    options: Vec<std::ffi::OsString>,
) -> Result<Image, Box<dyn std::error::Error>> {
    let path = root.join(format!("{name}.qcow2"));
    let mut arguments = vec!["create".into(), "-f".into(), "qcow2".into()];
    arguments.extend(options);
    arguments.extend([path.clone().into_os_string(), "4M".into()]);
    let created = capture(
        &NativeCommand {
            binary: "/usr/bin/qemu-img".into(),
            arguments,
            workspace: root.to_owned(),
            environment: BTreeMap::new(),
            input: false,
        },
        8192,
        Duration::from_secs(10),
        CancellationToken::new(),
    )
    .await?;
    if !created.status.success() {
        return Err(format!("Actual QEMU fixture creation: {}", created.errors).into());
    }
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))?;
    let sha256 = format!("{:x}", Sha256::digest(std::fs::read(&path)?));
    Ok(Image { path, sha256 })
}
#[tokio::test]
async fn actual_qcow2_digest_and_external_file_admission() -> Result<(), Box<dyn std::error::Error>>
{
    let root = tempfile::tempdir()?;
    let root = root.path();
    std::fs::set_permissions(root, std::fs::Permissions::from_mode(0o700))?;
    let base = create(root, "base", vec![]).await?;
    images::verify(&base, CancellationToken::new()).await?;
    let mismatch = images::verify(
        &Image {
            sha256: "0".repeat(64),
            ..base.clone()
        },
        CancellationToken::new(),
    )
    .await;
    assert!(mismatch.is_err_and(|error| error.message.contains("SHA256")));
    let backed = create(
        root,
        "external-backing",
        vec![
            "-F".into(),
            "qcow2".into(),
            "-b".into(),
            base.path.clone().into_os_string(),
        ],
    )
    .await?;
    assert!(
        images::verify(&backed, CancellationToken::new())
            .await
            .is_err()
    );
    let data = create(
        root,
        "external-data",
        vec![
            "-o".into(),
            format!("data_file={}", root.join("external.raw").display()).into(),
        ],
    )
    .await?;
    assert!(
        images::verify(&data, CancellationToken::new())
            .await
            .is_err()
    );
    let link = root.join("linked-image.qcow2");
    std::os::unix::fs::symlink(&base.path, &link)?;
    assert!(
        images::verify(
            &Image {
                path: link,
                ..base.clone()
            },
            CancellationToken::new()
        )
        .await
        .is_err()
    );
    std::fs::set_permissions(&base.path, std::fs::Permissions::from_mode(0o602))?;
    assert!(
        images::verify(&base, CancellationToken::new())
            .await
            .is_err()
    );
    std::fs::set_permissions(&base.path, std::fs::Permissions::from_mode(0o600))?;
    let cancelled = CancellationToken::new();
    cancelled.cancel();
    assert!(images::verify(&base, cancelled).await.is_err());
    Ok(())
}
