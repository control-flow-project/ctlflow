use crossfire_adapter_codex::{
    protocol::{Callbacks, Event, Protocol, Reply, Request, RequestId},
    websocket::WebSocketProtocol,
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode, secret::Secret};
use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use std::{sync::Arc, time::Duration};
use tokio::{
    io::{AsyncRead, AsyncWrite},
    net::{TcpListener, TcpStream},
    sync::{mpsc, oneshot},
    task::JoinHandle,
};
use tokio_tungstenite::{
    WebSocketStream, accept_hdr_async,
    tungstenite::{
        Message,
        handshake::server::{
            Callback, ErrorResponse, Request as UpgradeRequest, Response as UpgradeResponse,
        },
    },
};
use tokio_util::sync::CancellationToken;

struct Observation {
    events: mpsc::Sender<Event>,
    responded: mpsc::Sender<RequestId>,
    cancelled: mpsc::Sender<RequestId>,
}

impl Callbacks for Observation {
    fn event(&self, event: Event) {
        assert!(
            self.events.try_send(event).is_ok(),
            "Native fixture event capacity"
        );
    }
    async fn decision(&self, request: &Request, cancellation: CancellationToken) -> Result<Value> {
        if request.method == "fixture/answer" {
            return Ok(json!({"choice":"allow"}));
        }
        cancellation.cancelled().await;
        assert!(
            self.cancelled.try_send(request.id.clone()).is_ok(),
            "Native fixture cancellation capacity"
        );
        Err(Failure::new(
            ErrorCode::Native,
            "Fixture decision cancelled",
        ))
    }
    fn responded(&self, request: &Request) {
        assert!(
            self.responded.try_send(request.id.clone()).is_ok(),
            "Native fixture response capacity"
        );
    }
}

fn observations() -> (
    Arc<Observation>,
    mpsc::Receiver<Event>,
    mpsc::Receiver<RequestId>,
    mpsc::Receiver<RequestId>,
) {
    let (events, received) = mpsc::channel(8);
    let (responded, responses) = mpsc::channel(8);
    let (cancelled, cancellations) = mpsc::channel(8);
    (
        Arc::new(Observation {
            events,
            responded,
            cancelled,
        }),
        received,
        responses,
        cancellations,
    )
}

struct Peer {
    endpoint: String,
    task: Option<JoinHandle<std::result::Result<(), Box<dyn std::error::Error + Send + Sync>>>>,
}

struct Authenticate;
impl Callback for Authenticate {
    fn on_request(
        self,
        request: &UpgradeRequest,
        response: UpgradeResponse,
    ) -> std::result::Result<UpgradeResponse, ErrorResponse> {
        assert_eq!(
            request
                .headers()
                .get("authorization")
                .and_then(|value| value.to_str().ok()),
            Some("Bearer native-fixture-token")
        );
        Ok(response)
    }
}
impl Drop for Peer {
    fn drop(&mut self) {
        if let Some(task) = &self.task {
            task.abort();
        }
    }
}

impl Peer {
    async fn start<F, Output>(
        operation: F,
    ) -> std::result::Result<Self, Box<dyn std::error::Error + Send + Sync>>
    where
        F: FnOnce(WebSocketStream<TcpStream>) -> Output + Send + 'static,
        Output: std::future::Future<
                Output = std::result::Result<(), Box<dyn std::error::Error + Send + Sync>>,
            > + Send
            + 'static,
    {
        let listener = TcpListener::bind("127.0.0.1:0").await?;
        let endpoint = format!("ws://{}/", listener.local_addr()?);
        let task = tokio::spawn(async move {
            let (stream, _) = listener.accept().await?;
            let socket = accept_hdr_async(stream, Authenticate).await?;
            operation(socket).await
        });
        Ok(Self {
            endpoint,
            task: Some(task),
        })
    }
    async fn finish(mut self) -> std::result::Result<(), Box<dyn std::error::Error + Send + Sync>> {
        tokio::time::timeout(
            Duration::from_secs(3),
            self.task.take().ok_or("Missing peer task")?,
        )
        .await???;
        Ok(())
    }
}

async fn message<Stream: AsyncRead + AsyncWrite + Unpin>(
    socket: &mut WebSocketStream<Stream>,
) -> std::result::Result<Value, Box<dyn std::error::Error + Send + Sync>> {
    let value = socket.next().await.ok_or("Native peer disconnected")??;
    let Message::Text(value) = value else {
        return Err("Expected native text JSON".into());
    };
    Ok(serde_json::from_str(&value)?)
}

async fn open(peer: &Peer, observer: Arc<Observation>) -> Result<Arc<WebSocketProtocol>> {
    WebSocketProtocol::open(
        &peer.endpoint,
        &Secret::new("native-fixture-token".to_owned()),
        Duration::from_secs(2),
        observer,
        CancellationToken::new(),
    )
    .await
    .map(Arc::new)
}

fn reply(value: Reply) -> std::result::Result<Value, Box<dyn std::error::Error + Send + Sync>> {
    match value {
        Reply::Value(value) => Ok(value),
        Reply::Error(_) => Err("Unexpected native error".into()),
    }
}

#[tokio::test]
async fn actual_websocket_correlates_requests_notifications_and_native_decisions()
-> std::result::Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let peer = Peer::start(|mut socket| async move {
        let initialize = message(&mut socket).await?;
        socket.send(Message::Text(json!({"id":initialize["id"],"result":{"ready":true}}).to_string().into())).await?;
        let notification = message(&mut socket).await?;
        assert_eq!(notification["method"], "initialized");
        socket.send(Message::Text(json!({"method":"thread/started","params":{"threadId":"thread"}}).to_string().into())).await?;
        socket.send(Message::Text(json!({"id":"approval","method":"fixture/answer","params":{"threadId":"thread","turnId":"turn"}}).to_string().into())).await?;
        let answered = message(&mut socket).await?;
        assert_eq!(answered["id"], "approval"); assert_eq!(answered["result"], json!({"choice":"allow"}));
        let finish = message(&mut socket).await?;
        socket.send(Message::Text(json!({"id":finish["id"],"result":{"done":true}}).to_string().into())).await?;
        while socket.next().await.is_some() {}
        Ok(())
    }).await?;
    let (observer, mut events, mut responses, _) = observations();
    let protocol = open(&peer, observer).await?;
    assert_eq!(
        reply(
            protocol
                .request("initialize", &json!({}), CancellationToken::new())
                .await?
        )?["ready"],
        true
    );
    protocol
        .notify("initialized", CancellationToken::new())
        .await?;
    let event = tokio::time::timeout(Duration::from_secs(2), events.recv())
        .await?
        .ok_or("Missing native event")?;
    assert_eq!(event.method, "thread/started");
    assert_eq!(
        tokio::time::timeout(Duration::from_secs(2), responses.recv())
            .await?
            .ok_or("Missing actual response write")?,
        RequestId::Text("approval".to_owned())
    );
    assert_eq!(
        reply(
            protocol
                .request("finish", &json!({}), CancellationToken::new())
                .await?
        )?["done"],
        true
    );
    protocol.close().await?;
    peer.finish().await?;
    Ok(())
}

#[tokio::test]
async fn cancelled_call_keeps_the_sent_request_until_its_native_reply_arrives()
-> std::result::Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let (observed, arrived) = oneshot::channel();
    let (resume, released) = oneshot::channel();
    let peer = Peer::start(|mut socket| async move {
        let first = message(&mut socket).await?;
        let _observed = observed.send(());
        released.await?;
        socket
            .send(Message::Text(
                json!({"id":first["id"],"result":{"late":true}})
                    .to_string()
                    .into(),
            ))
            .await?;
        let second = message(&mut socket).await?;
        socket
            .send(Message::Text(
                json!({"id":second["id"],"result":{"current":true}})
                    .to_string()
                    .into(),
            ))
            .await?;
        while socket.next().await.is_some() {}
        Ok(())
    })
    .await?;
    let (observer, _, _, _) = observations();
    let protocol = open(&peer, observer).await?;
    let cancellation = CancellationToken::new();
    let current = Arc::clone(&protocol);
    let stopped = cancellation.clone();
    let first = tokio::spawn(async move { current.request("first", &json!({}), stopped).await });
    tokio::time::timeout(Duration::from_secs(2), arrived).await??;
    cancellation.cancel();
    assert!(first.await?.is_err());
    let _released = resume.send(());
    assert_eq!(
        reply(
            protocol
                .request("second", &json!({}), CancellationToken::new())
                .await?
        )?["current"],
        true
    );
    assert!(!protocol.lifetime().is_cancelled());
    protocol.close().await?;
    peer.finish().await?;
    Ok(())
}

#[tokio::test]
async fn ending_native_turn_cancels_its_unanswered_question_without_answering_it()
-> std::result::Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let peer = Peer::start(|mut socket| async move {
        socket.send(Message::Text(json!({"id":9,"method":"fixture/wait","params":{"threadId":"thread","turnId":"turn"}}).to_string().into())).await?;
        let cancel = message(&mut socket).await?;
        assert_eq!(cancel["method"], "cancel-turn");
        socket.send(Message::Text(json!({"method":"turn/completed","params":{"threadId":"thread","turn":{"id":"turn"}}}).to_string().into())).await?;
        socket.send(Message::Text(json!({"id":cancel["id"],"result":{}}).to_string().into())).await?;
        let after = message(&mut socket).await?;
        assert_eq!(after["method"], "after-cancellation");
        socket.send(Message::Text(json!({"id":after["id"],"result":{}}).to_string().into())).await?;
        while socket.next().await.is_some() {}
        Ok(())
    }).await?;
    let (observer, _events, _responses, mut cancelled) = observations();
    let protocol = open(&peer, observer).await?;
    protocol
        .request("cancel-turn", &json!({}), CancellationToken::new())
        .await?;
    assert_eq!(
        tokio::time::timeout(Duration::from_secs(2), cancelled.recv())
            .await?
            .ok_or("Question did not cancel")?,
        RequestId::Number(9)
    );
    protocol
        .request("after-cancellation", &json!({}), CancellationToken::new())
        .await?;
    protocol.close().await?;
    peer.finish().await?;
    Ok(())
}

#[tokio::test]
async fn malformed_native_identity_stops_transport_and_fails_pending_calls()
-> std::result::Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let peer = Peer::start(|mut socket| async move {
        let _first = message(&mut socket).await?;
        socket
            .send(Message::Text(
                json!({"id":9999,"result":{}}).to_string().into(),
            ))
            .await?;
        while socket.next().await.is_some() {}
        Ok(())
    })
    .await?;
    let (observer, _, _, _) = observations();
    let protocol = open(&peer, observer).await?;
    assert!(
        protocol
            .request("one", &json!({}), CancellationToken::new())
            .await
            .is_err()
    );
    assert!(protocol.lifetime().is_cancelled());
    protocol.close().await?;
    peer.finish().await?;
    Ok(())
}

#[tokio::test]
async fn endpoint_admission_refuses_external_hosts_missing_tokens_and_unsafe_urls()
-> std::result::Result<(), Box<dyn std::error::Error + Send + Sync>> {
    for endpoint in [
        "ws://remote.example/",
        "ws://user:password@127.0.0.1/",
        "ws://127.0.0.1/path",
        "ws://127.0.0.1/?token=secret",
        "unix://relative/socket",
    ] {
        let (observer, _, _, _) = observations();
        assert!(
            WebSocketProtocol::open(
                endpoint,
                &Secret::new("native-fixture-token".to_owned()),
                Duration::from_secs(1),
                observer,
                CancellationToken::new()
            )
            .await
            .is_err()
        );
    }
    Ok(())
}
