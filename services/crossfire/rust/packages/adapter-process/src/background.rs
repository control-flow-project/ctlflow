use crossfire_kernel::{Failure, Result, failure::ErrorCode};

pub fn redirect() -> Result<()> {
    let file = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open("/dev/null")
        .map_err(|_| failed())?;
    rustix::stdio::dup2_stdin(&file).map_err(|_| failed())?;
    rustix::stdio::dup2_stdout(&file).map_err(|_| failed())?;
    rustix::stdio::dup2_stderr(&file).map_err(|_| failed())
}
fn failed() -> Failure {
    Failure::new(
        ErrorCode::Unavailable,
        "Cannot detach the controller standard streams",
    )
}
