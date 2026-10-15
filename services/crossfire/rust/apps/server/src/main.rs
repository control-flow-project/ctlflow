use crossfire_server::host;
use tokio_util::sync::CancellationToken;

#[tokio::main]
async fn main() -> std::process::ExitCode {
    let result = async {
        let values = std::env::args().skip(1).collect::<Vec<_>>();
        let input = host::arguments(&values)?;
        let stop = CancellationToken::new();
        let signal = host::signals(stop.clone());
        let serving = host::run(input, stop.clone());
        tokio::pin!(signal); tokio::pin!(serving);
        let result = tokio::select! { biased; result = &mut serving => result, result = &mut signal => { result?; serving.await } };
        stop.cancel(); result
    }.await;
    match result {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(error) => {
            eprintln!(
                "Crossfire failed: {}: {}",
                error.code.as_str(),
                error.message
            );
            std::process::ExitCode::FAILURE
        }
    }
}
