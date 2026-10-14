use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use rustix::process::{Pid, PidfdFlags, Signal};
use std::{
    collections::BTreeMap,
    ffi::OsString,
    path::{Component, PathBuf},
    process::{ExitStatus, Stdio},
    time::Duration,
};
use tokio::{
    io::{AsyncRead, AsyncReadExt},
    process::{Child, ChildStderr, ChildStdin, ChildStdout, Command},
};
use tokio_util::sync::CancellationToken;

pub struct NativeCommand {
    pub binary: OsString,
    pub arguments: Vec<OsString>,
    pub workspace: PathBuf,
    pub environment: BTreeMap<OsString, Option<OsString>>,
    pub input: bool,
}

pub struct Output {
    pub status: ExitStatus,
    pub output: String,
    pub errors: String,
}

pub struct NativeProcess {
    child: Child,
    pid: Pid,
    exit: async_io::Async<std::os::fd::OwnedFd>,
    ended: Option<ExitStatus>,
}

fn failure(message: &str) -> Failure {
    Failure::new(ErrorCode::Native, message)
}

fn validate(command: &NativeCommand) -> Result<()> {
    use std::os::unix::ffi::OsStrExt;
    let invalid = |value: &std::ffi::OsStr| value.as_bytes().contains(&0);
    if command.binary.is_empty()
        || invalid(&command.binary)
        || !command.workspace.is_absolute()
        || command
            .workspace
            .components()
            .any(|value| !matches!(value, Component::RootDir | Component::Normal(_)))
        || command.arguments.iter().any(|value| invalid(value))
        || command
            .arguments
            .iter()
            .map(|value| value.len())
            .sum::<usize>()
            > 1024 * 1024
        || command.environment.iter().any(|(key, value)| {
            key.is_empty()
                || invalid(key)
                || key.as_bytes().contains(&b'=')
                || value.as_ref().is_some_and(|value| invalid(value))
        })
    {
        return Err(Failure::new(
            ErrorCode::Invalid,
            "Invalid native executable, workspace, arguments or environment",
        ));
    }
    if std::fs::canonicalize(&command.workspace)
        .map_err(|_| failure("Native workspace does not exist"))?
        .as_os_str()
        != command.workspace.as_os_str()
    {
        return Err(Failure::new(
            ErrorCode::Invalid,
            "Native workspace cannot traverse symbolic links",
        ));
    }
    Ok(())
}

impl NativeProcess {
    pub fn start(configuration: &NativeCommand) -> Result<Self> {
        validate(configuration)?;
        let mut command = Command::new(&configuration.binary);
        command
            .args(&configuration.arguments)
            .current_dir(&configuration.workspace)
            .stdin(if configuration.input {
                Stdio::piped()
            } else {
                Stdio::null()
            })
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .process_group(0);
        for (key, value) in &configuration.environment {
            match value {
                Some(value) => {
                    command.env(key, value);
                }
                None => {
                    command.env_remove(key);
                }
            }
        }
        let mut child = command.spawn().map_err(|_| {
            failure("Cannot start the native executable in its owned process group")
        })?;
        let Some(pid) = child
            .id()
            .and_then(|value| i32::try_from(value).ok())
            .and_then(Pid::from_raw)
        else {
            let _stopped = child.start_kill();
            return Err(failure("Native process did not expose its owned identity"));
        };
        let exit = rustix::process::pidfd_open(pid, PidfdFlags::empty()).and_then(|descriptor| {
            async_io::Async::new_nonblocking(descriptor).map_err(|_| rustix::io::Errno::IO)
        });
        let exit = match exit {
            Ok(value) => value,
            Err(_) => {
                let _stopped = rustix::process::kill_process_group(pid, Signal::KILL);
                return Err(failure(
                    "Native ownership requires Linux pidfd completion notification",
                ));
            }
        };
        Ok(Self {
            child,
            pid,
            exit,
            ended: None,
        })
    }

    pub fn id(&self) -> u32 {
        self.pid.as_raw_pid() as u32
    }
    pub fn output(&mut self) -> Result<ChildStdout> {
        self.child
            .stdout
            .take()
            .ok_or_else(|| failure("Native stdout already has an owner"))
    }
    pub fn errors(&mut self) -> Result<ChildStderr> {
        self.child
            .stderr
            .take()
            .ok_or_else(|| failure("Native stderr already has an owner"))
    }
    pub fn input(&mut self) -> Result<ChildStdin> {
        self.child
            .stdin
            .take()
            .ok_or_else(|| failure("Native stdin is disabled or already has an owner"))
    }

    pub async fn wait(&mut self) -> Result<ExitStatus> {
        if let Some(status) = self.ended {
            return Ok(status);
        }
        self.exit
            .readable()
            .await
            .map_err(|_| failure("Cannot observe owned native process completion"))?;
        self.signal(Signal::KILL)?;
        let status = self
            .child
            .wait()
            .await
            .map_err(|_| failure("Cannot observe native process completion"))?;
        self.ended = Some(status);
        Ok(status)
    }

    fn signal(&self, signal: Signal) -> Result<()> {
        if self.ended.is_some() {
            return Ok(());
        }
        match rustix::process::kill_process_group(self.pid, signal) {
            Ok(()) | Err(rustix::io::Errno::SRCH) => Ok(()),
            Err(_) => Err(failure("Cannot terminate the owned native process group")),
        }
    }

    pub async fn stop(&mut self) -> Result<ExitStatus> {
        self.signal(Signal::TERM)?;
        match tokio::time::timeout(Duration::from_secs(3), self.wait()).await {
            Ok(result) => result,
            Err(_) => {
                self.signal(Signal::KILL)?;
                tokio::time::timeout(Duration::from_secs(5), self.wait())
                    .await
                    .map_err(|_| {
                        failure("Native process group did not stop after forced termination")
                    })?
            }
        }
    }
}

impl Drop for NativeProcess {
    fn drop(&mut self) {
        let _stopped = self.signal(Signal::KILL);
    }
}

pub async fn collect(
    mut stream: impl AsyncRead + Unpin,
    maximum: usize,
    cancellation: CancellationToken,
) -> Result<String> {
    if maximum == 0 || maximum > 2 * 1024 * 1024 {
        return Err(Failure::new(
            ErrorCode::Invalid,
            "Invalid native output bound",
        ));
    }
    let mut bytes = Vec::new();
    let mut buffer = [0; 4096];
    loop {
        let count = tokio::select! { biased; _ = cancellation.cancelled() => return Err(failure("Native command collection cancelled")), value = stream.read(&mut buffer) => value.map_err(|_| failure("Cannot read native command output"))? };
        if count == 0 {
            return String::from_utf8(bytes)
                .map_err(|_| failure("Native command output is not valid UTF-8"));
        }
        if bytes.len() + count > maximum {
            return Err(failure("Native command output exceeds its byte bound"));
        }
        bytes.extend_from_slice(&buffer[..count]);
    }
}

pub async fn capture(
    command: &NativeCommand,
    maximum: usize,
    timeout: Duration,
    cancellation: CancellationToken,
) -> Result<Output> {
    if command.input
        || maximum == 0
        || maximum > 2 * 1024 * 1024
        || timeout < Duration::from_millis(100)
        || timeout > Duration::from_secs(300)
    {
        return Err(Failure::new(
            ErrorCode::Invalid,
            "Native command collection requires bounded output, deadline and no interactive input",
        ));
    }
    if cancellation.is_cancelled() {
        return Err(failure("Native command collection cancelled"));
    }
    let mut process = NativeProcess::start(command)?;
    let output = process.output()?;
    let errors = process.errors()?;
    let stop = cancellation.child_token();
    let collected = async {
        let (output, errors, status) = tokio::try_join!(
            collect(output, maximum, stop.clone()),
            collect(errors, maximum, stop.clone()),
            process.wait()
        )?;
        Ok(Output {
            status,
            output,
            errors,
        })
    };
    let result = tokio::select! { biased; _ = cancellation.cancelled() => Err(failure("Native command collection cancelled")), value = tokio::time::timeout(timeout, collected) => match value { Ok(result) => result, Err(_) => Err(failure("Native command collection exceeded its deadline")) } };
    if result.is_err() {
        stop.cancel();
        process.stop().await?;
    }
    result
}
