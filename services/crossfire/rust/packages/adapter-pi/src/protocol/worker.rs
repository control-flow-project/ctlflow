use super::{Events, MAX_FRAME_BYTES, State, Write, error};
use crate::options;
use crossfire_adapter_process::NativeProcess;
use crossfire_kernel::Result;
use serde_json::{Value, json};
use std::sync::Arc;
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt},
    sync::mpsc,
    task::JoinSet,
    time::Instant,
};

fn receive(state: &State, event: &Value, control: bool) -> Result<()> {
    let object = event
        .as_object()
        .ok_or_else(|| error("Invalid native Pi response"))?;
    let id = object
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| error("Uncorrelated native Pi response"))?;
    let mut tracker = state
        .tracker
        .lock()
        .map_err(|_| error("Native Pi request ownership failed"))?;
    let Some(pending) = tracker.pending.get(id) else {
        return Ok(());
    };
    let response = if control {
        if pending.command.is_some() {
            return Err(error("Mismatched native Pi control response"));
        }
        Ok(object
            .get("data")
            .cloned()
            .ok_or_else(|| error("Missing private Pi control response"))?)
    } else {
        if object.get("command").and_then(Value::as_str) != pending.command.as_deref()
            || !object.get("success").is_some_and(Value::is_boolean)
        {
            return Err(error("Mismatched native Pi response"));
        }
        if object.get("success") == Some(&json!(true)) {
            Ok(object.get("data").cloned().unwrap_or(Value::Null))
        } else {
            Err(error(&options::error_text(
                object
                    .get("error")
                    .and_then(Value::as_str)
                    .unwrap_or("Native Pi command failed"),
            )))
        }
    };
    let pending = tracker
        .pending
        .remove(id)
        .ok_or_else(|| error("Native Pi request lost its owner"))?;
    drop(tracker);
    let _received = pending.response.send(response);
    Ok(())
}

fn route(state: &State, event: Value, events: &impl Events) -> Result<()> {
    let value = event
        .as_object()
        .ok_or_else(|| error("Invalid native Pi object"))?;
    if value.get("type").and_then(Value::as_str) == Some("response") {
        return receive(state, &event, false);
    }
    if value.get("type").and_then(Value::as_str) == Some("extension_ui_request")
        && value.get("method").and_then(Value::as_str) == Some("notify")
        && let Some(message) = value.get("message").and_then(Value::as_str)
    {
        if message.starts_with("{\"crossfire\":true,") {
            let response: Value = serde_json::from_str(message)
                .map_err(|_| error("Invalid private Pi control response"))?;
            return receive(state, &response, true);
        }
        if message.starts_with("{\"crossfireEvent\":\"interruption\",") {
            let response: Value = serde_json::from_str(message)
                .map_err(|_| error("Invalid private Pi interruption event"))?;
            let turn = response
                .get("turn")
                .and_then(Value::as_str)
                .ok_or_else(|| error("Invalid private Pi interruption identity"))?;
            return events.event(json!({"type":"interruption_started","turn":turn}));
        }
    }
    events.event(event)
}

async fn read(
    mut input: impl AsyncRead + Unpin,
    state: Arc<State>,
    events: Arc<impl Events>,
) -> Result<()> {
    let mut buffer = [0; 8192];
    let mut pending = Vec::new();
    loop {
        let count = input
            .read(&mut buffer)
            .await
            .map_err(|_| error("Native Pi output pipe closed"))?;
        if count == 0 {
            return Err(error("Native Pi output ended"));
        }
        for part in buffer[..count].split_inclusive(|value| *value == b'\n') {
            if pending.len() + part.len() > MAX_FRAME_BYTES + 1 {
                return Err(error(
                    "Native Pi protocol frame exceeds its finite byte budget",
                ));
            }
            pending.extend_from_slice(part);
            if part.last() == Some(&b'\n') {
                if pending.len() > 1 {
                    let event = serde_json::from_slice(&pending)
                        .map_err(|_| error("Native Pi emitted invalid JSON"))?;
                    route(&state, event, events.as_ref())?;
                }
                pending.clear();
            }
        }
    }
}
async fn write(
    mut input: impl AsyncWrite + Unpin,
    state: Arc<State>,
    mut ordinary: mpsc::Receiver<Write>,
    mut urgent: mpsc::Receiver<Write>,
) -> Result<()> {
    loop {
        let message = tokio::select! { biased; _ = state.lifetime.cancelled() => return Ok(()), value = urgent.recv() => value, value = ordinary.recv() => value };
        let Some(message) = message else {
            return Ok(());
        };
        if message.cancellation.is_cancelled() {
            let _skipped = message.flushed.send(Err(error(
                "Native Pi command cancelled before transmission",
            )));
            continue;
        }
        input
            .write_all(&message.bytes)
            .await
            .map_err(|_| error("Native Pi input pipe closed"))?;
        input
            .flush()
            .await
            .map_err(|_| error("Native Pi input flush failed"))?;
        let _flushed = message.flushed.send(Ok(()));
    }
}
async fn deadlines(state: Arc<State>) -> Result<()> {
    loop {
        let changed = state.changed.notified();
        tokio::pin!(changed);
        changed.as_mut().enable();
        let deadline = state
            .tracker
            .lock()
            .map_err(|_| error("Native Pi request ownership failed"))?
            .pending
            .values()
            .map(|value| value.deadline)
            .min();
        match deadline {
            Some(deadline) => {
                tokio::select! { biased; _ = state.lifetime.cancelled() => return Ok(()), _ = &mut changed => {}, _ = tokio::time::sleep_until(deadline) => {} }
            }
            None => {
                tokio::select! { biased; _ = state.lifetime.cancelled() => return Ok(()), _ = &mut changed => {} }
            }
        }
        if state
            .tracker
            .lock()
            .map_err(|_| error("Native Pi request ownership failed"))?
            .pending
            .values()
            .any(|value| value.deadline <= Instant::now())
        {
            return Err(error("Native Pi command timed out"));
        }
    }
}

pub(super) struct Pipes {
    pub input: tokio::process::ChildStdin,
    pub output: tokio::process::ChildStdout,
    pub errors: tokio::process::ChildStderr,
}
pub(super) fn start(
    mut native: NativeProcess,
    pipes: Pipes,
    state: Arc<State>,
    events: Arc<impl Events + 'static>,
    ordinary: mpsc::Receiver<Write>,
    urgent: mpsc::Receiver<Write>,
) {
    tokio::spawn(async move {
        let Pipes {
            input,
            output,
            mut errors,
        } = pipes;
        struct Completion(Arc<State>);
        impl Drop for Completion {
            fn drop(&mut self) {
                self.0.fail(error("Native Pi supervisor ended"));
                self.0.closed.cancel();
            }
        }
        let _completion = Completion(Arc::clone(&state));
        let mut jobs = JoinSet::new();
        jobs.spawn(read(output, Arc::clone(&state), events));
        jobs.spawn(write(input, Arc::clone(&state), ordinary, urgent));
        jobs.spawn(deadlines(Arc::clone(&state)));
        jobs.spawn(async move {
            let mut buffer = [0; 8192];
            while errors
                .read(&mut buffer)
                .await
                .map_err(|_| error("Native Pi diagnostics pipe closed"))?
                != 0
            {}
            Ok(())
        });
        let result = loop {
            tokio::select! { biased;
                _ = state.lifetime.cancelled() => break Ok(()),
                result = native.wait() => break result.and_then(|_| Err(error("Owned Pi process exited"))),
                result = jobs.join_next(), if !jobs.is_empty() => match result {
                    Some(Ok(Ok(()))) => {},
                    Some(Ok(Err(failure))) => break Err(failure),
                    _ => break Err(error("Native Pi protocol worker failed")),
                }
            }
        };
        if let Err(failure) = result {
            state.fail(failure);
        }
        if let Err(failure) = native.stop().await {
            if let Ok(mut cleanup) = state.stop_failure.lock() {
                *cleanup = Some(failure.clone());
            }
            state.fail(failure);
        }
        jobs.abort_all();
        while jobs.join_next().await.is_some() {}
    });
}
