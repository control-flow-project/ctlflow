use crossfire_adapter_http::operation;
use crossfire_adapter_http::server;
use crossfire_contracts::{call::Call, operations::OperationId};
use crossfire_kernel::failure::ErrorCode;
use serde_json::json;
use std::sync::Arc;
use tokio_util::sync::CancellationToken;

struct LiveServer {
    stop: CancellationToken,
    task: tokio::task::JoinHandle<crossfire_kernel::Result<()>>,
}
#[tokio::test]
async fn native_binary_operations_preserve_exact_bytes_bounds_authentication_and_cancellation()
-> Result<(), Box<dyn std::error::Error>> {
    use std::sync::atomic::{AtomicUsize, Ordering};
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let origin = format!("http://{}", listener.local_addr()?);
    let stop = CancellationToken::new();
    let expected = bytes::Bytes::from([0_u8, 128, 255, 10].repeat(512 * 1024));
    let state = Arc::new((expected.clone(), AtomicUsize::new(0)));
    let task = tokio::spawn(server::serve(
        server::Listener::Tcp(listener),
        Arc::clone(&state),
        |state, request, _peer| async move {
            state.1.fetch_add(1, Ordering::SeqCst);
            assert_eq!(request.method(), server::Method::PUT);
            assert_eq!(
                request
                    .headers()
                    .get("content-type")
                    .and_then(|value| value.to_str().ok()),
                Some("application/octet-stream")
            );
            assert_eq!(
                request
                    .headers()
                    .get("authorization")
                    .and_then(|value| value.to_str().ok()),
                Some("Bearer exact-agent-token")
            );
            let bytes = server::read(request.into_body(), 8 * 1024 * 1024).await?;
            assert!(
                bytes.as_ref() == state.0.as_ref(),
                "binary bytes are preserved without JSON or UTF-8 conversion"
            );
            Ok(server::Response::new(server::full(json!({"data":{"uploaded":true},"meta":{"requestId":"00000000-0000-4000-8000-000000000000"}}).to_string())))
        },
        server::Limits::default(),
        stop.clone(),
    ));
    let source = LiveServer { stop, task };
    let client = operation::Client::new(
        &origin,
        Some(crossfire_kernel::secret::Secret::new(
            "exact-agent-token".to_owned(),
        )),
        source.stop.child_token(),
    )?;
    let mut call = Call::new(OperationId::UploadPublicationFile);
    call.parameters.insert(
        "publicationId".to_owned(),
        "00000000-0000-4000-8000-000000000000".to_owned(),
    );
    call.parameters.insert(
        "fileId".to_owned(),
        "00000000-0000-4000-8000-000000000001".to_owned(),
    );
    assert_eq!(
        client
            .upload(&call, expected.clone(), CancellationToken::new())
            .await?
            .data,
        json!({"uploaded":true})
    );
    assert_eq!(state.1.load(Ordering::SeqCst), 1);
    assert_eq!(
        client
            .call(&call, CancellationToken::new())
            .await
            .err()
            .map(|error| error.code),
        Some(ErrorCode::Invalid)
    );
    let cancelled = CancellationToken::new();
    cancelled.cancel();
    assert_eq!(
        client
            .upload(&call, expected.clone(), cancelled)
            .await
            .err()
            .map(|error| error.code),
        Some(ErrorCode::Unavailable)
    );
    let too_large = bytes::Bytes::from(vec![0; 8 * 1024 * 1024 + 1]);
    assert_eq!(
        client
            .upload(&call, too_large, CancellationToken::new())
            .await
            .err()
            .map(|error| error.code),
        Some(ErrorCode::BodyTooLarge)
    );
    call.body = Some(json!({}));
    assert_eq!(
        client
            .upload(&call, expected, CancellationToken::new())
            .await
            .err()
            .map(|error| error.code),
        Some(ErrorCode::Invalid)
    );
    assert_eq!(
        state.1.load(Ordering::SeqCst),
        1,
        "rejected uploads do not issue HTTP requests"
    );
    source.stop.cancel();
    Ok(())
}
impl Drop for LiveServer {
    fn drop(&mut self) {
        self.stop.cancel();
        self.task.abort();
    }
}
#[tokio::test]
async fn real_operation_transport_uses_the_operations_request_limit_not_a_hidden_one_megabyte_cap()
-> Result<(), Box<dyn std::error::Error>> {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let origin = format!("http://{}", listener.local_addr()?);
    let stop = CancellationToken::new();
    let task = tokio::spawn(server::serve(
        server::Listener::Tcp(listener),
        Arc::new(()),
        |_state, request, _peer| async {
            let value = server::json(request.into_body(), 16 * 1024 * 1024).await?;
            let length = value
                .get("review")
                .and_then(serde_json::Value::as_str)
                .map_or(0, str::len);
            let response = json!({"data":{"received":length},"meta":{"requestId":"00000000-0000-4000-8000-000000000000"}});
            server::Response::builder()
                .status(201)
                .header("content-type", "application/json")
                .body(server::full(response.to_string()))
                .map_err(|_| {
                    crossfire_kernel::Failure::new(
                        ErrorCode::Unavailable,
                        "Test response encoding failed",
                    )
                })
        },
        server::Limits::default(),
        stop.clone(),
    ));
    let source = LiveServer { stop, task };
    let client = operation::Client::new(&origin, None, source.stop.child_token())?;
    let mut call = Call::agent(
        OperationId::CreateRuntimeDecision,
        "00000000-0000-4000-8000-000000000000",
    );
    call.body = Some(json!({"review":"x".repeat(2*1024*1024)}));
    let response = client.call(&call, CancellationToken::new()).await?;
    assert_eq!(response.data["received"].as_u64(), Some(2 * 1024 * 1024));
    let cancel = CancellationToken::new();
    cancel.cancel();
    assert_eq!(
        client
            .call(&call, cancel)
            .await
            .err()
            .map(|error| error.code),
        Some(ErrorCode::Unavailable)
    );
    source.stop.cancel();
    Ok(())
}

#[test]
fn paths_envelopes_collections_and_failures_follow_the_declared_contract()
-> Result<(), Box<dyn std::error::Error>> {
    let id = "00000000-0000-4000-8000-000000000000";
    let mut input = Call::agent(OperationId::Grant, id);
    input
        .parameters
        .insert("roomId".to_owned(), "!native/a?%:local".to_owned());
    assert_eq!(
        operation::target(&input)?,
        format!("/api/agents/{id}/room-grants/!native%2Fa%3F%25%3Alocal")
    );
    input.query.insert("alias".to_owned(), "invalid".to_owned());
    assert!(operation::target(&input).is_err());
    input.query.clear();
    input.parameters.insert("unused".to_owned(), id.to_owned());
    assert!(operation::target(&input).is_err());
    let value = json!({"data":[],"meta":{"requestId":id,"page":1,"pageSize":20,"totalItems":0,"totalPages":1}});
    let result = operation::decode(200, value.clone(), 200, true)?;
    assert!(result.data.is_array());
    assert_eq!(result.metadata.total_pages, Some(1));
    for value in [
        json!({"data":[],"meta":{"requestId":id,"page":1,"pageSize":20,"totalItems":0,"totalPages":0}}),
        json!({"data":[],"meta":{"requestId":id}}),
        json!({"data":{},"meta":value["meta"]}),
        json!({"data":[],"meta":{"requestId":"bad"}}),
        json!({"data":[],"meta":value["meta"],"alias":true}),
    ] {
        assert!(operation::decode(200, value, 200, true).is_err());
    }
    let failure = operation::decode(
        409,
        json!({"error":{"code":"name_collision","message":"Reserved"},"meta":{"requestId":id}}),
        201,
        false,
    );
    assert_eq!(
        failure.err().map(|error| error.code),
        Some(ErrorCode::NameCollision)
    );
    assert!(
        operation::decode(
            409,
            json!({"error":{"code":"invented","message":"Bad"},"meta":{"requestId":id}}),
            201,
            false
        )
        .is_err()
    );
    Ok(())
}
