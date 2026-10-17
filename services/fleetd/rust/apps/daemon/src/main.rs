use tokio_util::sync::CancellationToken;

#[tokio::main]
async fn main() -> std::process::ExitCode {
    let result = async {
        let values = std::env::args().skip(1).collect::<Vec<_>>();
        let input = fleetd_daemon::host::arguments(&values)?;
        let stop = CancellationToken::new();
        let signals = fleetd_daemon::host::signals(stop.clone());
        let running = fleetd_daemon::host::run(input, stop.clone());
        tokio::pin!(signals); tokio::pin!(running);
        tokio::select! { biased; result=&mut running=>result, result=&mut signals=> { result?; running.await } }
    }.await;
    match result {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("fleetd failed: {}: {}", error.code.as_str(), error.message);
            std::process::ExitCode::FAILURE
        }
    }
}
