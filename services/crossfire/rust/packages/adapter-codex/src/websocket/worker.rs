use super::{
    Decision, State, Write,
    endpoint::Socket,
    error,
    frame::{self, Frame},
};
use crate::protocol::Callbacks;
use crossfire_kernel::Result;
use futures_util::{FutureExt, SinkExt, StreamExt, stream::SplitSink};
use serde_json::json;
use std::{panic::AssertUnwindSafe, sync::Arc, time::Duration};
use tokio::{
    sync::mpsc,
    task::{JoinHandle, JoinSet},
    time::Instant,
};
use tokio_tungstenite::tungstenite::Message;

pub(super) fn start(
    socket: Socket,
    state: Arc<State>,
    callbacks: Arc<impl Callbacks + 'static>,
    urgent: mpsc::Sender<Write>,
    urgent_receive: mpsc::Receiver<Write>,
    ordinary_receive: mpsc::Receiver<Write>,
    timeout: Duration,
) -> (JoinHandle<()>, JoinHandle<()>) {
    let (sink, mut stream) = socket.split();
    let writing_state = Arc::clone(&state);
    let writing = tokio::spawn(async move {
        if AssertUnwindSafe(write(
            sink,
            Arc::clone(&writing_state),
            urgent_receive,
            ordinary_receive,
            timeout,
        ))
        .catch_unwind()
        .await
        .is_err()
        {
            writing_state.fail(error("Codex native writer stopped unexpectedly"));
        }
    });
    let reading = tokio::spawn(async move {
        let operation = async {
            let mut tasks = JoinSet::new();
            loop {
                let deadline = state.inspect(|tracker| {
                    Ok(tracker.pending.values().map(|value| value.deadline).min())
                })?;
                let wait = async {
                    if let Some(deadline) = deadline {
                        tokio::time::sleep_until(deadline).await;
                    } else {
                        std::future::pending::<()>().await;
                    }
                };
                tokio::select! {
                    biased;
                    _ = state.lifetime.cancelled() => break,
                    _ = state.deadline_changed.notified() => continue,
                    _ = wait => {
                        if state.inspect(|tracker| Ok(tracker.pending.values().any(|value| value.deadline <= Instant::now())))? {
                            return Err(error("Codex request timed out; native message receipt remains unverified"));
                        }
                    }
                    result = tasks.join_next(), if !tasks.is_empty() => {
                        if result.is_some_and(|value| value.is_err()) { return Err(error("Codex native decision handler stopped unexpectedly")); }
                    }
                    received = stream.next() => {
                        match received {
                            Some(Ok(Message::Text(text))) => receive(frame::decode(text.as_bytes())?, &state, &callbacks, &urgent, &mut tasks)?,
                            Some(Ok(Message::Ping(bytes))) => urgent.try_send(Write { message: Message::Pong(bytes), request_id: None, cancellation: state.lifetime.clone(), confirmed: None }).map_err(|_| error("Codex control queue is full"))?,
                            Some(Ok(Message::Pong(_))) => {},
                            Some(Ok(Message::Close(_))) | None => return Err(error("Codex WebSocket disconnected")),
                            _ => return Err(error("Expected native Codex text JSON")),
                        }
                    }
                }
            }
            tasks.abort_all();
            while tasks.join_next().await.is_some() {}
            Ok::<_, crossfire_kernel::Failure>(())
        };
        match AssertUnwindSafe(operation).catch_unwind().await {
            Ok(Ok(())) => {}
            Ok(Err(reason)) => state.fail(reason),
            Err(_) => state.fail(error("Codex native event processing stopped unexpectedly")),
        }
    });
    (reading, writing)
}

fn receive(
    frame: Frame,
    state: &Arc<State>,
    callbacks: &Arc<impl Callbacks + 'static>,
    urgent: &mpsc::Sender<Write>,
    tasks: &mut JoinSet<()>,
) -> Result<()> {
    match frame {
        Frame::Reply(id, reply) => {
            let pending = state.inspect(|tracker| {
                if tracker.pending.get(&id).is_none_or(|value| !value.sent) {
                    return Err(error("Unexpected Codex response identity"));
                }
                tracker
                    .pending
                    .remove(&id)
                    .ok_or_else(|| error("Unexpected Codex response identity"))
            })?;
            let _closed = pending.response.send(Ok(reply));
            state.deadline_changed.notify_one();
        }
        Frame::Event(event) => {
            state.inspect(|tracker| {
                for (id, decision) in &tracker.decisions {
                    let resolved = event.method == "serverRequest/resolved"
                        && event.params.get("requestId").is_some_and(|value| {
                            frame::identity(value).is_ok_and(|value| value == *id)
                        });
                    let ended = matches!(event.method.as_str(), "thread/closed" | "turn/completed")
                        && event.params.get("threadId") == decision.thread.as_ref()
                        && (event.method == "thread/closed"
                            || event.params.get("turn").and_then(|value| value.get("id"))
                                == decision.turn.as_ref());
                    if resolved || ended {
                        decision.cancellation.cancel();
                    }
                }
                Ok(())
            })?;
            callbacks.event(event);
        }
        Frame::Request(request) => {
            let cancellation = state.lifetime.child_token();
            state.inspect(|tracker| {
                if tracker.decisions.len() >= 16 || tracker.decisions.contains_key(&request.id) {
                    return Err(error("Duplicate or excessive native approval requests"));
                }
                tracker.decisions.insert(
                    request.id.clone(),
                    Decision {
                        cancellation: cancellation.clone(),
                        thread: request.params.get("threadId").cloned(),
                        turn: request.params.get("turnId").cloned(),
                    },
                );
                Ok(())
            })?;
            let state = Arc::clone(state);
            let callbacks = Arc::clone(callbacks);
            let urgent = urgent.clone();
            tasks.spawn(async move {
                let value = callbacks.decision(&request, cancellation.clone()).await;
                if !cancellation.is_cancelled() {
                    let success = value.is_ok();
                    let response = match value {
                        Ok(value) => json!({"id":frame::id_value(&request.id),"result":value}),
                        Err(failure) => json!({"id":frame::id_value(&request.id),"error":{"code":-32602,"message":failure.message}}),
                    };
                    let encoded = serde_json::to_string(&response);
                    match encoded {
                        Ok(encoded) if encoded.len() <= super::MAX_FRAME_BYTES => {
                            let (confirmed, receive) = tokio::sync::oneshot::channel();
                            let write = Write { message: Message::Text(encoded.into()), request_id: None, cancellation: cancellation.clone(), confirmed: Some(confirmed) };
                            let sent = tokio::select! { biased; _ = cancellation.cancelled() => false, result = urgent.send(write) => result.is_ok() };
                            if sent {
                                let written = tokio::select! { biased; result = receive => matches!(result, Ok(Ok(()))), _ = cancellation.cancelled() => false };
                                if written && success { callbacks.responded(&request); }
                            }
                        }
                        _ => state.fail(error("Codex native decision response exceeds its frame budget")),
                    }
                }
                let _removed = state.inspect(|tracker| { tracker.decisions.remove(&request.id); Ok(()) });
            });
        }
    }
    Ok(())
}

async fn write(
    mut sink: SplitSink<Socket, Message>,
    state: Arc<State>,
    mut urgent: mpsc::Receiver<Write>,
    mut ordinary: mpsc::Receiver<Write>,
    timeout: Duration,
) {
    loop {
        let received = tokio::select! { biased; _ = state.lifetime.cancelled() => break, value = urgent.recv() => value, value = ordinary.recv() => value };
        let Some(value) = received else {
            state.fail(error("Codex native writer queue closed"));
            break;
        };
        if value.cancellation.is_cancelled() {
            if let Some(id) = value.request_id {
                let _cancelled = state.inspect(|tracker| {
                    if let Some(pending) = tracker.pending.remove(&id) {
                        let _closed = pending.response.send(Err(error(
                            "Codex request cancelled before native transmission",
                        )));
                    }
                    Ok(())
                });
            }
            continue;
        }
        if let Some(id) = value.request_id {
            match state.inspect(|tracker| {
                Ok(if let Some(pending) = tracker.pending.get_mut(&id) {
                    pending.sent = true;
                    true
                } else {
                    false
                })
            }) {
                Ok(true) => {}
                Ok(false) => continue,
                Err(reason) => {
                    state.fail(reason);
                    break;
                }
            }
        }
        let sent = tokio::select! { biased; _ = state.lifetime.cancelled() => break, value = tokio::time::timeout(timeout, sink.send(value.message)) => value };
        if !matches!(sent, Ok(Ok(()))) {
            state.fail(error(
                "Codex WebSocket write failed; native message receipt remains unverified",
            ));
            break;
        }
        if let Some(confirmed) = value.confirmed {
            let _received = confirmed.send(Ok(()));
        }
    }
}
