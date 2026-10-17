use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use serde_json::Value;
use std::{collections::BTreeMap, time::Duration};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    sync::{mpsc, oneshot},
    task::{JoinHandle, JoinSet},
};

type Response = (u16, Vec<u8>, BTreeMap<String, String>);

pub struct Call {
    pub method: String,
    pub target: String,
    pub headers: BTreeMap<String, String>,
    pub body: Value,
    reply: oneshot::Sender<Option<Response>>,
}

impl Call {
    pub fn reply(self, status: u16, value: &Value) -> Result<()> {
        let body = serde_json::to_vec(value).map_err(|_| invalid())?;
        self.raw(
            status,
            body,
            BTreeMap::from([("Content-Type".to_owned(), "application/json".to_owned())]),
        )
    }

    pub fn raw(self, status: u16, body: Vec<u8>, headers: BTreeMap<String, String>) -> Result<()> {
        self.reply
            .send(Some((status, body, headers)))
            .map_err(|_| invalid())
    }

    pub fn close(self) -> Result<()> {
        self.reply.send(None).map_err(|_| invalid())
    }
}

pub struct Fixture {
    pub origin: String,
    receiver: mpsc::Receiver<Result<Call>>,
    task: JoinHandle<()>,
}

impl Drop for Fixture {
    fn drop(&mut self) {
        self.task.abort();
    }
}

fn invalid() -> Failure {
    Failure::new(ErrorCode::Invalid, "Invalid bounded HTTP fixture exchange")
}

impl Fixture {
    pub async fn open() -> std::result::Result<Self, Box<dyn std::error::Error>> {
        let listener = TcpListener::bind("127.0.0.1:0").await?;
        let origin = format!("http://{}", listener.local_addr()?);
        let (sender, receiver) = mpsc::channel(32);
        let task = tokio::spawn(async move {
            let mut exchanges = JoinSet::new();
            loop {
                tokio::select! {
                    _ = sender.closed() => break,
                    completed = exchanges.join_next(), if !exchanges.is_empty() => {
                        if completed.is_some_and(|result| result.is_err()) { let _reported = sender.send(Err(invalid())).await; }
                    }
                    accepted = listener.accept(), if exchanges.len() < 32 => {
                        let Ok((socket, _)) = accepted else { break; };
                        let sender = sender.clone();
                        exchanges.spawn(async move {
                            if let Err(error) = exchange(socket, &sender).await { let _reported = sender.send(Err(error)).await; }
                        });
                    }
                }
            }
        });
        Ok(Self {
            origin,
            receiver,
            task,
        })
    }

    pub async fn next(&mut self) -> Result<Call> {
        tokio::time::timeout(Duration::from_secs(5), self.receiver.recv())
            .await
            .map_err(|_| {
                Failure::new(
                    ErrorCode::Unavailable,
                    "Expected HTTP fixture call did not arrive",
                )
            })?
            .ok_or_else(invalid)?
    }
}

async fn exchange(mut socket: TcpStream, sender: &mpsc::Sender<Result<Call>>) -> Result<()> {
    let mut bytes = Vec::new();
    let mut chunk = [0_u8; 8192];
    let boundary = loop {
        let count = socket.read(&mut chunk).await.map_err(|_| invalid())?;
        if count == 0 || bytes.len() + count > 65536 {
            return Err(invalid());
        }
        bytes.extend_from_slice(&chunk[..count]);
        if let Some(boundary) = bytes.windows(4).position(|window| window == b"\r\n\r\n") {
            break boundary + 4;
        }
    };
    let head = std::str::from_utf8(&bytes[..boundary]).map_err(|_| invalid())?;
    let mut lines = head.split("\r\n");
    let mut parts = lines.next().ok_or_else(invalid)?.split(' ');
    let method = parts.next().ok_or_else(invalid)?.to_owned();
    let target = parts.next().ok_or_else(invalid)?.to_owned();
    if parts.next() != Some("HTTP/1.1") || parts.next().is_some() {
        return Err(invalid());
    }
    let mut headers = BTreeMap::new();
    for line in lines.filter(|line| !line.is_empty()) {
        let (name, value) = line.split_once(':').ok_or_else(invalid)?;
        if headers
            .insert(name.to_ascii_lowercase(), value.trim().to_owned())
            .is_some()
        {
            return Err(invalid());
        }
    }
    let length = headers
        .get("content-length")
        .map_or(Ok(0), |value| value.parse::<usize>())
        .map_err(|_| invalid())?;
    if length > 1024 * 1024 || headers.contains_key("transfer-encoding") {
        return Err(invalid());
    }
    if bytes.len() > boundary + length {
        return Err(invalid());
    }
    let mut body = bytes.split_off(boundary);
    let received = body.len();
    body.resize(length, 0);
    socket
        .read_exact(&mut body[received..])
        .await
        .map_err(|_| invalid())?;
    let body = if length == 0 {
        Value::Null
    } else {
        serde_json::from_slice(&body).map_err(|_| invalid())?
    };
    let (reply, receipt) = oneshot::channel();
    sender
        .send(Ok(Call {
            method,
            target,
            headers,
            body,
            reply,
        }))
        .await
        .map_err(|_| invalid())?;
    let Some((status, body, headers)) = receipt.await.map_err(|_| invalid())? else {
        return Ok(());
    };
    let mut head = format!(
        "HTTP/1.1 {status} Fixture\r\nContent-Length: {}\r\nConnection: close\r\n",
        body.len()
    );
    for (name, value) in headers {
        head.push_str(&format!("{name}: {value}\r\n"));
    }
    head.push_str("\r\n");
    socket
        .write_all(head.as_bytes())
        .await
        .map_err(|_| invalid())?;
    socket.write_all(&body).await.map_err(|_| invalid())?;
    socket.shutdown().await.map_err(|_| invalid())?;
    Ok(())
}
