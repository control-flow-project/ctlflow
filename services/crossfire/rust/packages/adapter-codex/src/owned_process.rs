use crate::{capability, options};
use crossfire_adapter_filesystem::{PrivateDirectory, owned::OwnedFile};
use crossfire_adapter_process::{NativeCommand, NativeProcess, capture};
use crossfire_kernel::{Failure, Result, failure::ErrorCode, identity, secret::Secret};
use futures_util::FutureExt;
use std::{
    collections::BTreeMap,
    ffi::OsString,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::{
    io::{AsyncRead, AsyncReadExt},
    sync::mpsc,
    task::JoinSet,
};
use tokio_util::sync::CancellationToken;

pub struct Launch<'a> {
    pub home: &'a Path,
    pub workspace: &'a Path,
    pub state: &'a Path,
    pub profile: &'a str,
    pub binary: &'a std::ffi::OsStr,
    pub questions: bool,
}

struct Credential {
    directory: PrivateDirectory,
    name: String,
}
impl Drop for Credential {
    fn drop(&mut self) {
        let _removed = self.directory.remove(&self.name);
    }
}

struct State {
    close: CancellationToken,
    lifetime: CancellationToken,
    closed: CancellationToken,
    failure: Mutex<Option<Failure>>,
}

pub struct OwnedProcess {
    pub endpoint: String,
    pub token: Secret,
    pub token_file: PathBuf,
    pub pid: u32,
    state: Arc<State>,
}

struct Completion(Arc<State>);
impl Drop for Completion {
    fn drop(&mut self) {
        self.0.lifetime.cancel();
        self.0.closed.cancel();
    }
}

fn failure(message: &str) -> Failure {
    Failure::new(ErrorCode::Native, message)
}

fn environment(input: &Launch<'_>) -> BTreeMap<OsString, Option<OsString>> {
    BTreeMap::from([
        (
            OsString::from("CODEX_HOME"),
            Some(input.home.as_os_str().to_owned()),
        ),
        (
            OsString::from("CROSSFIRE_PROJECT"),
            Some(input.state.as_os_str().to_owned()),
        ),
        (
            OsString::from("CROSSFIRE_AGENT_NAME"),
            Some(OsString::from(input.profile)),
        ),
        (OsString::from("CODEX_THREAD_ID"), None),
    ])
}

fn command(input: &Launch<'_>, arguments: impl IntoIterator<Item = OsString>) -> NativeCommand {
    NativeCommand {
        binary: input.binary.to_owned(),
        arguments: arguments.into_iter().collect(),
        workspace: input.workspace.to_owned(),
        environment: environment(input),
        input: false,
    }
}

pub async fn inspect_instructions(
    input: &Launch<'_>,
    cancellation: CancellationToken,
) -> Result<()> {
    PrivateDirectory::open(input.home, false)?;
    let directory = tempfile::Builder::new()
        .prefix(".crossfire-protocol-")
        .permissions(std::fs::Permissions::from_mode(0o700))
        .tempdir_in(input.home)
        .map_err(|_| failure("Cannot prepare private native protocol inspection"))?;
    let parameters = [
        OsString::from("app-server"),
        OsString::from("generate-json-schema"),
        OsString::from("--out"),
        directory.path().as_os_str().to_owned(),
        OsString::from("--experimental"),
    ];
    let result = capture(
        &command(input, parameters),
        65_536,
        Duration::from_secs(10),
        cancellation,
    )
    .await?;
    if !result.status.success() {
        return Err(failure(
            "Cannot inspect native Codex developer-instruction capability",
        ));
    }
    let file = OwnedFile::open(
        &directory.path().join("ClientRequest.json"),
        2 * 1024 * 1024,
    )?
    .ok_or_else(|| failure("Codex did not expose its actual native request schema"))?;
    let information = file.information()?;
    let bytes = file.read_at(information.size as usize, 0)?;
    if file.information()? != information {
        return Err(failure("Native protocol schema changed during inspection"));
    }
    capability::instructions(
        &serde_json::from_slice(&bytes)
            .map_err(|_| failure("Invalid native Codex request schema"))?,
    )
}

fn endpoint(line: &[u8]) -> Option<String> {
    let text = std::str::from_utf8(line).ok()?.trim();
    let endpoint = text.strip_prefix("listening on: ")?;
    let port = endpoint.strip_prefix("ws://127.0.0.1:")?;
    if port.is_empty()
        || !port.bytes().all(|value| value.is_ascii_digit())
        || port.parse::<u16>().ok()? == 0
    {
        return None;
    }
    Some(endpoint.to_owned())
}

async fn pump(mut stream: impl AsyncRead + Unpin, ready: mpsc::Sender<String>) -> Result<()> {
    let mut buffer = [0; 8192];
    let mut line = Vec::new();
    let mut oversized = false;
    loop {
        let count = stream
            .read(&mut buffer)
            .await
            .map_err(|_| failure("Owned native diagnostic stream failed"))?;
        if count == 0 {
            return Ok(());
        }
        for segment in buffer[..count].split_inclusive(|value| *value == b'\n') {
            let ended = segment.last() == Some(&b'\n');
            if !oversized {
                if line.len() + segment.len() <= 64_000 {
                    line.extend_from_slice(segment);
                } else {
                    oversized = true;
                    line.clear();
                }
            }
            if ended {
                if let Some(endpoint) = endpoint(&line) {
                    let _observed = ready.try_send(endpoint);
                }
                line.clear();
                oversized = false;
            }
        }
    }
}

async fn supervise(
    mut process: NativeProcess,
    state: Arc<State>,
    credential: Credential,
    ready: mpsc::Sender<String>,
    cancellation: CancellationToken,
) {
    let completion = Completion(Arc::clone(&state));
    let operation = async {
        let mut streams = JoinSet::new();
        streams.spawn(pump(process.output()?, ready.clone()));
        streams.spawn(pump(process.errors()?, ready));
        let ended = loop {
            tokio::select! { biased;
                _ = state.close.cancelled() => break false,
                _ = cancellation.cancelled() => break false,
                result = streams.join_next(), if !streams.is_empty() => {
                    match result { Some(Ok(Ok(()))) => {}, _ => return Err(failure("Owned native diagnostic stream ended unexpectedly")) }
                },
                result = process.wait() => { result?; break true; }
            }
        };
        state.lifetime.cancel();
        process.stop().await?;
        streams.abort_all();
        while let Some(result) = streams.join_next().await {
            match result {
                Ok(result) => result?,
                Err(reason) if reason.is_cancelled() => {}
                Err(_) => return Err(failure("Owned native output task stopped unexpectedly")),
            }
        }
        if ended {
            Err(failure("Owned Codex process exited"))
        } else {
            Ok(())
        }
    };
    let result = match std::panic::AssertUnwindSafe(operation).catch_unwind().await {
        Ok(result) => result,
        Err(_) => Err(failure(
            "Owned native process supervision stopped unexpectedly",
        )),
    };
    state.lifetime.cancel();
    let stopped = process.stop().await;
    if let Err(reason) = result.and(stopped.map(|_| ()))
        && let Ok(mut value) = state.failure.lock()
    {
        *value = Some(reason);
    }
    drop(process);
    drop(credential);
    drop(completion);
}

impl OwnedProcess {
    pub async fn start(input: &Launch<'_>, cancellation: CancellationToken) -> Result<Self> {
        crossfire_adapter_runtime::clock::check(&cancellation)?;
        let home = PrivateDirectory::open(input.home, false)?;
        PrivateDirectory::open(input.state, false)?;
        if input.profile.is_empty()
            || input.profile.len() > 200
            || input.profile.chars().any(char::is_control)
        {
            return Err(Failure::new(
                ErrorCode::Invalid,
                "Use an exact native agent profile",
            ));
        }
        let version = capture(
            &command(input, [OsString::from("--version")]),
            4096,
            Duration::from_secs(10),
            cancellation.clone(),
        )
        .await?;
        if !version.status.success() {
            return Err(failure("Cannot inspect native Codex version"));
        }
        options::version(version.output.trim())?;
        inspect_instructions(input, cancellation.clone()).await?;
        if input.questions {
            let features = capture(
                &command(input, [OsString::from("features"), OsString::from("list")]),
                65_536,
                Duration::from_secs(10),
                cancellation.clone(),
            )
            .await?;
            if !features.status.success() {
                return Err(failure("Cannot inspect native Codex question support"));
            }
            options::question_capability(&features.output)?;
        }
        let path = std::env::var("PATH")
            .map_err(|_| failure("Codex requires a native executable search path"))?;
        if path.is_empty() || path.len() > 4096 || path.chars().any(char::is_control) {
            return Err(failure(
                "Codex requires a bounded native executable search path",
            ));
        }
        crossfire_adapter_runtime::clock::check(&cancellation)?;
        let bytes = identity::random_bytes::<32>()?;
        let token = Secret::new(bytes.iter().map(|byte| format!("{byte:02x}")).collect());
        let name = format!(".crossfire-token-{}", identity::id());
        home.write_new(&name, token.expose().as_bytes())?;
        let token_file = input.home.join(&name);
        let credential = Credential {
            directory: home,
            name,
        };
        let parameters = [
            OsString::from("app-server"),
            OsString::from("--listen"),
            OsString::from("ws://127.0.0.1:0"),
            OsString::from("--ws-auth"),
            OsString::from("capability-token"),
            OsString::from("--ws-token-file"),
            token_file.as_os_str().to_owned(),
        ];
        let process = NativeProcess::guarded(&command(input, parameters), input.home, "codex")?;
        let pid = process.id();
        let state = Arc::new(State {
            close: CancellationToken::new(),
            lifetime: CancellationToken::new(),
            closed: CancellationToken::new(),
            failure: Mutex::new(None),
        });
        let (ready, mut receive) = mpsc::channel(1);
        tokio::spawn(supervise(
            process,
            Arc::clone(&state),
            credential,
            ready,
            cancellation.clone(),
        ));
        let selected = tokio::select! { biased;
            _ = cancellation.cancelled() => Err(failure("Codex startup cancelled")),
            _ = state.lifetime.cancelled() => Err(failure("Codex exited before readiness")),
            result = tokio::time::timeout(Duration::from_secs(15), receive.recv()) => match result { Ok(Some(endpoint)) => Ok(endpoint), _ => Err(failure("Codex readiness timed out")) }
        };
        match selected {
            Ok(endpoint) => Ok(Self {
                endpoint,
                token,
                token_file,
                pid,
                state,
            }),
            Err(reason) => {
                state.close.cancel();
                state.closed.cancelled().await;
                Err(reason)
            }
        }
    }

    pub fn lifetime(&self) -> CancellationToken {
        self.state.lifetime.clone()
    }
    pub async fn close(&self) -> Result<()> {
        self.state.close.cancel();
        self.state.closed.cancelled().await;
        let value = self
            .state
            .failure
            .lock()
            .map_err(|_| failure("Native process owner failed"))?;
        match &*value {
            Some(reason) => Err(reason.clone()),
            None => Ok(()),
        }
    }
}

impl Drop for OwnedProcess {
    fn drop(&mut self) {
        self.state.close.cancel();
    }
}
