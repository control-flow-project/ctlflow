use crossfire_adapter_filesystem::owned::{self, OwnedFile};
use crossfire_adapter_process::{NativeCommand, Output, capture};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use std::{collections::BTreeMap, ffi::OsString, path::Path, time::Duration};
use tokio_util::sync::CancellationToken;

async fn git(directory: &Path, args: &[&str], stop: CancellationToken) -> Result<Output> {
    capture(
        &NativeCommand {
            binary: "git".into(),
            arguments: [
                vec![OsString::from("-C"), directory.as_os_str().to_owned()],
                args.iter().map(OsString::from).collect(),
            ]
            .concat(),
            workspace: directory.to_owned(),
            environment: BTreeMap::new(),
            input: false,
        },
        1048576,
        Duration::from_secs(10),
        stop,
    )
    .await
}
pub async fn protect(directory: &Path, paths: &[&str], stop: CancellationToken) -> Result<()> {
    let repository = git(
        directory,
        &["rev-parse", "--is-inside-work-tree"],
        stop.clone(),
    )
    .await?;
    if repository.status.code() == Some(128) {
        return Ok(());
    }
    if !repository.status.success() {
        return Err(Failure::new(
            ErrorCode::Unavailable,
            "Git could not verify project credential privacy",
        ));
    }
    let mut missing = Vec::new();
    for path in paths {
        let pattern = if *path == "**/workarea/" {
            ":(glob)**/workarea/**"
        } else {
            path
        };
        let tracked = git(directory, &["ls-files", "--", pattern], stop.clone()).await?;
        if !tracked.status.success() {
            return Err(Failure::new(
                ErrorCode::Unavailable,
                "Cannot inspect private tracked files",
            ));
        }
        if !tracked.output.trim().is_empty() {
            return Err(Failure::new(
                ErrorCode::Forbidden,
                format!(
                    "Private fleet integration files are tracked by Git: {path}; remove them from tracking before starting"
                ),
            ));
        }
        let probe = if *path == "**/workarea/" {
            "agents/privacy-check/workarea/check/check.json".to_owned()
        } else if path.ends_with('/') {
            format!("{path}check.json")
        } else {
            path.to_string()
        };
        let ignored = git(
            directory,
            &["check-ignore", "--quiet", "--", &probe],
            stop.clone(),
        )
        .await?;
        match ignored.status.code() {
            Some(0) => {}
            Some(1) => missing.push(*path),
            _ => {
                return Err(Failure::new(
                    ErrorCode::Unavailable,
                    "Cannot verify private Git exclusions",
                ));
            }
        }
    }
    if !missing.is_empty() {
        let file = directory.join(".gitignore");
        let mut original = OwnedFile::open(&file, 1048576)?
            .map(|file| file.configuration(1048576))
            .transpose()?
            .unwrap_or_default();
        original.extend_from_slice(format!("\n{}\n", missing.join("\n")).as_bytes());
        owned::write_configuration(&file, &original, 1048576)?;
    }
    Ok(())
}
