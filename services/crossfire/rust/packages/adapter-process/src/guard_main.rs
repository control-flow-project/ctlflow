use crossfire_adapter_filesystem::{PrivateDirectory, lock::StateLock};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use rustix::process::{Pid, PidfdFlags, Signal};
use std::{ffi::OsString, path::PathBuf, time::Duration};
use tokio::{
    process::Command,
    signal::unix::{SignalKind, signal},
};

fn failed() -> Failure {
    Failure::new(
        ErrorCode::Unavailable,
        "Native parent ownership could not be established",
    )
}
async fn run() -> Result<()> {
    let args = std::env::args_os().skip(1).collect::<Vec<_>>();
    if args.len() < 8
        || args[0] != "--parent"
        || args[2] != "--directory"
        || args[4] != "--identity"
        || args[6] != "--"
        || rustix::process::getpgrp() != rustix::process::getpid()
    {
        return Err(failed());
    }
    let parent = args[1]
        .to_str()
        .and_then(|value| value.parse::<i32>().ok())
        .and_then(Pid::from_raw)
        .ok_or_else(failed)?;
    if rustix::process::getppid() != Some(parent) {
        return Err(failed());
    }
    let parent_fd =
        rustix::process::pidfd_open(parent, PidfdFlags::empty()).map_err(|_| failed())?;
    let parent_fd = async_io::Async::new_nonblocking(parent_fd).map_err(|_| failed())?;
    if rustix::process::getppid() != Some(parent) {
        return Err(failed());
    }
    let directory = PathBuf::from(&args[3]);
    let identity = args[5]
        .to_str()
        .filter(|value| {
            !value.is_empty()
                && value.len() <= 64
                && value
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
        })
        .ok_or_else(failed)?;
    PrivateDirectory::open(&directory, false)?;
    let mut interrupt = signal(SignalKind::interrupt()).map_err(|_| failed())?;
    let mut terminate = signal(SignalKind::terminate()).map_err(|_| failed())?;
    let mut hangup = signal(SignalKind::hangup()).map_err(|_| failed())?;
    let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
    let mut retry = tokio::time::interval(Duration::from_millis(25));
    let _ownership = loop {
        if rustix::process::getppid() != Some(parent) {
            return Err(failed());
        }
        match StateLock::acquire(&directory.join(format!("crossfire-native-process-{identity}"))) {
            Ok(ownership) => break ownership,
            Err(error) if error.code == ErrorCode::Conflict => {}
            Err(error) => return Err(error),
        }
        tokio::select! { biased;
            _=parent_fd.readable()=>return Err(failed()),
            _=terminate.recv()=>return Err(failed()),
            _=interrupt.recv()=>return Err(failed()),
            _=hangup.recv()=>return Err(failed()),
            _=tokio::time::sleep_until(deadline)=>return Err(failed()),
            _=retry.tick()=>{},
        }
    };
    if rustix::process::getppid() != Some(parent) {
        return Err(failed());
    }
    let executable: &OsString = &args[7];
    let mut child = Command::new(executable)
        .args(&args[8..])
        .kill_on_drop(true)
        .spawn()
        .map_err(|_| failed())?;
    tokio::select! { biased;
        _=parent_fd.readable()=>{},
        _=terminate.recv()=>{},
        _=interrupt.recv()=>{},
        _=hangup.recv()=>{},
        _=child.wait()=>{},
    }
    rustix::process::kill_process_group(rustix::process::getpgrp(), Signal::KILL)
        .map_err(|_| failed())?;
    Err(failed())
}
#[tokio::main(flavor = "current_thread")]
async fn main() -> std::process::ExitCode {
    match run().await {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("{}", error.message);
            std::process::ExitCode::FAILURE
        }
    }
}
