use super::request::invalid;
use crossfire_adapter_process::{NativeCommand, NativeProcess};
use crossfire_kernel::Result;
use std::{
    path::Path,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tokio::{
    io::{AsyncRead, AsyncReadExt},
    process::ChildStdin,
    sync::watch,
};
use tokio_util::sync::CancellationToken;

pub struct Helper {
    pub input: Option<ChildStdin>,
    stop: CancellationToken,
    closed: watch::Receiver<Option<Result<()>>>,
    tail: Arc<Mutex<String>>,
}
impl Helper {
    pub fn start(command: &NativeCommand) -> Result<Self> {
        let mut process = NativeProcess::start(command)?;
        let input = if command.input {
            Some(process.input()?)
        } else {
            None
        };
        let output = process.output()?;
        let errors = process.errors()?;
        let tail = Arc::new(Mutex::new(String::new()));
        let stdout = tokio::spawn(drain(output, tail.clone()));
        let stderr = tokio::spawn(drain(errors, tail.clone()));
        let stop = CancellationToken::new();
        let stopping = stop.clone();
        let (complete, closed) = watch::channel(None);
        tokio::spawn(async move {
            let result = tokio::select! { biased; _=stopping.cancelled()=>process.stop().await, result=process.wait()=>result }.map(|_| ());
            let output = stdout
                .await
                .map_err(|_| invalid("VM stdout observer failed"))
                .and_then(|value| value);
            let errors = stderr
                .await
                .map_err(|_| invalid("VM stderr observer failed"))
                .and_then(|value| value);
            complete.send_replace(Some(result.and(output).and(errors)));
        });
        Ok(Self {
            input,
            stop,
            closed,
            tail,
        })
    }
    pub fn diagnostic(&self) -> String {
        self.tail
            .lock()
            .map(|value| value.clone())
            .unwrap_or_else(|_| "VM diagnostics unavailable".to_owned())
    }
    pub fn check(&self) -> Result<()> {
        if self.closed.borrow().is_some() {
            return Err(invalid(&format!(
                "VM helper exited unexpectedly: {}",
                self.diagnostic()
            )));
        }
        Ok(())
    }
    pub async fn close(&self) -> Result<()> {
        self.stop.cancel();
        let mut closed = self.closed.clone();
        loop {
            let result = closed.borrow().clone();
            if let Some(result) = result {
                return result;
            }
            closed
                .changed()
                .await
                .map_err(|_| invalid("VM helper cleanup ended without confirmation"))?;
        }
    }
}
impl Drop for Helper {
    fn drop(&mut self) {
        self.stop.cancel();
    }
}
pub async fn drain(mut input: impl AsyncRead + Unpin, tail: Arc<Mutex<String>>) -> Result<()> {
    let mut buffer = [0; 4096];
    loop {
        let count = input
            .read(&mut buffer)
            .await
            .map_err(|_| invalid("Cannot read VM helper diagnostics"))?;
        if count == 0 {
            return Ok(());
        }
        let mut tail = tail
            .lock()
            .map_err(|_| invalid("VM diagnostic ownership failed"))?;
        tail.push_str(&String::from_utf8_lossy(&buffer[..count]));
        if tail.len() > 16384 {
            let mut start = tail.len() - 16384;
            while !tail.is_char_boundary(start) {
                start += 1;
            }
            tail.drain(..start);
        }
    }
}
pub async fn wait(
    observed: impl Fn() -> Result<bool>,
    helpers: &[Helper],
    seconds: u64,
    stop: &CancellationToken,
) -> Result<()> {
    let deadline = Instant::now() + Duration::from_secs(seconds);
    while !observed()? {
        for helper in helpers {
            helper.check()?;
        }
        if Instant::now() >= deadline {
            return Err(invalid(&format!(
                "VM prerequisite did not become ready within {seconds} seconds"
            )));
        }
        tokio::select! { biased; _=stop.cancelled()=>return Err(invalid("VM execution cancelled")), _=tokio::time::sleep(Duration::from_millis(25))=>{} }
    }
    Ok(())
}
pub fn socket_ready(path: &Path) -> Result<bool> {
    match std::os::unix::net::UnixStream::connect(path) {
        Ok(_) => Ok(true),
        Err(error)
            if matches!(
                error.kind(),
                std::io::ErrorKind::NotFound | std::io::ErrorKind::ConnectionRefused
            ) =>
        {
            Ok(false)
        }
        Err(_) => Err(invalid("Cannot inspect private VM helper socket")),
    }
}
