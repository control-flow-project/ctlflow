use crossfire_adapter_filesystem::{PrivateDirectory, socket::Socket};
use crossfire_adapter_http::server;
use crossfire_contracts::{call::Call, operations::Method};
use crossfire_kernel::secret::Secret;
use fleet_daemon_client::Client;
use fleetd_contracts::operations::{OPERATIONS, OperationId};
use serde_json::json;
use std::{
    os::unix::fs::{PermissionsExt, symlink},
    sync::Arc,
};
use tokio_util::sync::CancellationToken;

struct Running {
    stop: CancellationToken,
    task: tokio::task::JoinHandle<crossfire_kernel::Result<()>>,
}
impl Drop for Running {
    fn drop(&mut self) {
        self.stop.cancel();
        self.task.abort();
    }
}
#[tokio::test]
async fn every_daemon_operation_uses_the_same_contract_transport_over_a_real_private_long_path_socket()
-> Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    std::fs::set_permissions(directory.path(), std::fs::Permissions::from_mode(0o700))?;
    let mut path = directory.path().to_owned();
    let mut owned = PrivateDirectory::open(&path, false)?;
    for _depth in 0..4 {
        let component = "long-".repeat(10);
        owned = owned.child(&component, true)?;
        path.push(component);
    }
    path.push("daemon.sock");
    assert!(path.as_os_str().len() > 108);
    let socket = Socket::prepare(&path)?;
    let listener = tokio::net::UnixListener::bind(socket.endpoint())?;
    socket.protect()?;
    let stop = CancellationToken::new();
    let task = tokio::spawn(server::serve(
        server::Listener::Unix(listener),
        Arc::new(()),
        |_state, request, peer| async move {
            assert_eq!(
                request
                    .headers()
                    .get("authorization")
                    .and_then(|value| value.to_str().ok()),
                Some(format!("Bearer {}", "a".repeat(64)).as_str())
            );
            if !matches!(peer, server::Peer::Unix(_)) {
                return Err(crossfire_kernel::Failure::new(
                    crossfire_kernel::failure::ErrorCode::Forbidden,
                    "Fixture requires an authenticated Unix peer",
                ));
            }
            let count = usize::from(request.method() == server::Method::GET);
            let template = OPERATIONS
                .iter()
                .find(|operation| {
                    let segments = request.uri().path().split('/').collect::<Vec<_>>();
                    let parts = operation.path.split('/').collect::<Vec<_>>();
                    parts.len() == segments.len()
                        && parts
                            .iter()
                            .zip(segments)
                            .all(|(part, segment)| part.starts_with('{') || part == &segment)
                        && match operation.method {
                            Method::Get => request.method() == server::Method::GET,
                            Method::Post => request.method() == server::Method::POST,
                            Method::Put => request.method() == server::Method::PUT,
                            Method::Patch => request.method() == server::Method::PATCH,
                            Method::Delete => request.method() == server::Method::DELETE,
                        }
                })
                .ok_or_else(|| {
                    crossfire_kernel::Failure::new(
                        crossfire_kernel::failure::ErrorCode::Invalid,
                        "Unknown fixture operation",
                    )
                })?;
            if count == 0 {
                let value = server::json(request.into_body(), 1048576).await?;
                if !value.is_object() {
                    return Err(crossfire_kernel::Failure::new(
                        crossfire_kernel::failure::ErrorCode::Invalid,
                        "Fixture input must be an object",
                    ));
                }
            }
            let mut metadata = json!({"requestId":"00000000-0000-4000-8000-000000000000"});
            let data = if template.collection {
                metadata["page"] = json!(1);
                metadata["pageSize"] = json!(20);
                metadata["totalItems"] = json!(0);
                metadata["totalPages"] = json!(1);
                json!([])
            } else {
                json!({"operation":template.name})
            };
            server::Response::builder()
                .status(template.status)
                .header("content-type", "application/json")
                .body(server::full(
                    json!({"data":data,"meta":metadata}).to_string(),
                ))
                .map_err(|_| {
                    crossfire_kernel::Failure::new(
                        crossfire_kernel::failure::ErrorCode::Invalid,
                        "Fixture response failed",
                    )
                })
        },
        server::Limits::default(),
        stop.clone(),
    ));
    let running = Running { stop, task };
    let client = Client::authenticated(
        &path,
        running.stop.child_token(),
        Secret::new("a".repeat(64)),
    )?;
    for operation in OPERATIONS {
        let mut request = Call::new(operation.id);
        for name in operation.path.split('/').filter_map(|part| {
            part.strip_prefix('{')
                .and_then(|value| value.strip_suffix('}'))
        }) {
            request.parameters.insert(
                name.to_owned(),
                if name == "instanceKey" {
                    "analyst-high"
                } else {
                    "00000000-0000-4000-8000-000000000000"
                }
                .to_owned(),
            );
        }
        let response = client.call(&request, CancellationToken::new()).await?;
        if operation.collection {
            assert!(response["items"].is_array());
            assert_eq!(response["meta"]["totalPages"], 1);
        } else {
            assert_eq!(response["operation"], operation.name);
        }
    }
    let cancel = CancellationToken::new();
    cancel.cancel();
    assert!(
        client
            .call(&Call::new(OperationId::Status), cancel)
            .await
            .is_err()
    );
    let linked = path.parent().ok_or("parent required")?.join("linked.sock");
    symlink(&path, &linked)?;
    assert!(
        Client::authenticated(
            &linked,
            CancellationToken::new(),
            Secret::new("a".repeat(64))
        )
        .is_err()
    );
    running.stop.cancel();
    Ok(())
}
