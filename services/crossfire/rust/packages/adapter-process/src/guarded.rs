use crate::{NativeCommand, NativeProcess, failure};
use crossfire_adapter_filesystem::{PrivateDirectory, assets::Directory};
use crossfire_kernel::Result;
use std::{ffi::OsString, os::unix::fs::MetadataExt, path::Path};

impl NativeProcess {
    pub fn guarded(
        configuration: &NativeCommand,
        directory: &Path,
        identity: &str,
    ) -> Result<Self> {
        PrivateDirectory::open(directory, false)?;
        if identity.is_empty()
            || identity.len() > 64
            || !identity
                .bytes()
                .all(|value| value.is_ascii_alphanumeric() || matches!(value, b'-' | b'_'))
        {
            return Err(failure(
                "Native process ownership requires an exact bounded identity",
            ));
        }
        let executable = match std::env::var_os("CROSSFIRE_NATIVE_GUARD") {
            Some(path) => path.into(),
            None => std::env::current_exe()
                .map_err(|_| failure("Native executable location is unavailable"))?
                .parent()
                .ok_or_else(|| failure("Native executable parent is unavailable"))?
                .join("crossfire-native-guard"),
        };
        let parent = Directory::open(
            executable
                .parent()
                .ok_or_else(|| failure("Invalid native guard executable"))?,
        )?;
        let file = parent
            .file(
                executable
                    .file_name()
                    .and_then(|name| name.to_str())
                    .ok_or_else(|| failure("Invalid native guard executable"))?,
                64 * 1024 * 1024,
            )?
            .ok_or_else(|| {
                failure("The selected native distribution is missing crossfire-native-guard")
            })?;
        let metadata = file.metadata()?;
        if metadata.mode() & 0o022 != 0
            || metadata.mode() & 0o111 == 0
            || ![0, rustix::process::getuid().as_raw()].contains(&metadata.uid())
        {
            return Err(failure(
                "Native guard executable requires trusted ownership and non-writable executable permissions",
            ));
        }
        let mut arguments = vec![
            OsString::from("--parent"),
            rustix::process::getpid().as_raw_pid().to_string().into(),
            OsString::from("--directory"),
            directory.as_os_str().to_owned(),
            OsString::from("--identity"),
            identity.into(),
            OsString::from("--"),
            configuration.binary.clone(),
        ];
        arguments.extend(configuration.arguments.iter().cloned());
        Self::start(&NativeCommand {
            binary: executable.into_os_string(),
            arguments,
            workspace: configuration.workspace.clone(),
            environment: configuration.environment.clone(),
            input: configuration.input,
        })
    }
}
