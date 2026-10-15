use crossfire_server::{container, host, operator};
use tokio_util::sync::CancellationToken;

#[tokio::main]
async fn main() -> std::process::ExitCode {
    let result = async {
        let values = std::env::args().skip(1).collect::<Vec<_>>();
        if values.is_empty() || values == ["--help"] { println!("{}",operator::USAGE); return Ok(()); }
        let stop = CancellationToken::new();
        let signal = host::signals(stop.clone());
        let serving = async {
            match values[0].as_str() {
                "serve" => {
                    let input = host::arguments(&values)?;
                    let diagnostics = host::diagnostics(&input.directory)?;
                    let result = host::run(input,stop.clone(),diagnostics.clone()).await;
                    diagnostics.close();
                    result
                },
                "container" if values.len()==1 => container::run(stop.clone()).await,
                "init" | "start" => operator::run(&values,stop.clone()).await,
                _ => Err(crossfire_kernel::Failure::new(crossfire_kernel::failure::ErrorCode::Invalid,operator::USAGE)),
            }
        };
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
