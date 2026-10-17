use tokio_util::sync::CancellationToken;

#[tokio::main]
async fn main() -> std::process::ExitCode {
    let stop = CancellationToken::new();
    let received = stop.clone();
    let signal = tokio::spawn(async move {
        let mut interrupt =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::interrupt())?;
        let mut terminate =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())?;
        tokio::select! {_=received.cancelled()=>{},_=interrupt.recv()=>received.cancel(),_=terminate.recv()=>received.cancel()};
        Ok::<_, std::io::Error>(())
    });
    let result = fleet_cli::commands::run(std::env::args().skip(1).collect(), stop.clone()).await;
    signal.abort();
    match result {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(error) => {
            eprintln!(
                "{}: {}",
                error.code.as_str(),
                if stop.is_cancelled() {
                    "CLI disconnected; accepted operations continue in fleetd"
                } else {
                    &error.message
                }
            );
            std::process::ExitCode::FAILURE
        }
    }
}
