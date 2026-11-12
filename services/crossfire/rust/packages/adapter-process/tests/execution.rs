use crossfire_adapter_process::{NativeCommand, execution::NativeExecution};
use crossfire_kernel::{Failure, failure::ErrorCode};
use std::{collections::BTreeMap, sync::Arc, time::Duration};
use tokio_util::sync::CancellationToken;

#[tokio::test]
async fn rejected_execution_is_not_retried_on_host_and_capture_runs_the_selected_invocation()
-> Result<(), Box<dyn std::error::Error>> {
    let original = NativeCommand {
        binary: "/cannot-run-this-on-the-host".into(),
        arguments: vec!["original argument".into()],
        workspace: std::env::temp_dir(),
        environment: BTreeMap::new(),
        input: false,
    };
    let rejected = NativeExecution {
        command: Arc::new(|_| {
            Err(Failure::new(
                ErrorCode::Forbidden,
                "selected placement rejected",
            ))
        }),
        endpoint: Arc::new(|_, _| {
            Box::pin(async {
                Err(Failure::new(
                    ErrorCode::Forbidden,
                    "selected endpoint rejected",
                ))
            })
        }),
        ssh: None,
    };
    let refused = rejected
        .capture(
            &original,
            1024,
            Duration::from_secs(5),
            CancellationToken::new(),
        )
        .await;
    assert!(
        refused.is_err_and(|error| error.code == ErrorCode::Forbidden
            && error.message == "selected placement rejected")
    );
    let closed =
        (rejected.endpoint)("ws://127.0.0.1:9876".to_owned(), CancellationToken::new()).await;
    assert!(closed.is_err_and(|error| error.message == "selected endpoint rejected"));
    let selected = NativeExecution {
        command: Arc::new(|command| {
            let mut selected = command.clone();
            selected.binary = "/usr/bin/printf".into();
            selected.arguments = vec!["%s".into(), command.arguments[0].clone()];
            Ok(selected)
        }),
        ..NativeExecution::default()
    };
    let captured = selected
        .capture(
            &original,
            1024,
            Duration::from_secs(5),
            CancellationToken::new(),
        )
        .await?;
    assert_eq!(captured.output, "original argument");
    Ok(())
}
