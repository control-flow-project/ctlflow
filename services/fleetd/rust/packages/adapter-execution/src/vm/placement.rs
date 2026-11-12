use super::{
    budget, helpers,
    request::{Request, invalid},
    resources, supervisor,
};
use crossfire_adapter_filesystem::PrivateDirectory;
use crossfire_adapter_process::{
    NativeCommand, NativeProcess, capture,
    execution::NativeExecution,
    ssh_commands::{self, SshExecution},
};
use crossfire_adapter_runtime::{
    execution_state, ownership,
    placement::{LeaseRequest, NativeLease, NativePlacement},
};
use crossfire_kernel::{Result, identity};
use fleetd_domain::model::{Configuration, Instance};
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt},
    sync::{Mutex as AsyncMutex, watch},
};
use tokio_util::sync::CancellationToken;

#[derive(Clone)]
enum State {
    Starting,
    Admitted,
    Ready,
    Failed(crossfire_kernel::Failure),
    Closed(Result<()>, String),
}
struct Session {
    stop: CancellationToken,
    state: watch::Receiver<State>,
    execution: NativeExecution,
}
pub fn create(
    configuration: Configuration,
    instance: Instance,
    listener_port: Option<u16>,
) -> NativePlacement {
    NativePlacement {
        open: Arc::new(move |native, cancellation| {
            let configuration = configuration.clone();
            let instance = instance.clone();
            Box::pin(open(
                configuration,
                instance,
                listener_port,
                native,
                cancellation,
            ))
        }),
    }
}
async fn open(
    configuration: Configuration,
    instance: Instance,
    listener_port: Option<u16>,
    native: LeaseRequest,
    stop: CancellationToken,
) -> Result<NativeLease> {
    let id = identity::id();
    super::execution_files::create(&id)?;
    let directory = super::execution_files::runtime(&id)?;
    let mut files_owned = true;
    let started = async {
        let request = Request {
            id: id.clone(),
            directory: directory.clone(),
            fleet: configuration.directory.clone(),
            instance: instance.key.clone(),
            digest: configuration.digest.clone(),
            native,
            listener_port,
        };
        let selection = request.select()?;
        request.write()?;
        ownership::prepare(
            &request.native.directory,
            &request.native.workspace,
            &request.native.home,
        )?;
        let session = {
            let control = fleetd_storage::vm_budget::directory(&configuration.directory)?;
            PrivateDirectory::open(&control, true)?;
            let admission = budget::open(
                &configuration.directory,
                &control,
                &selection.catalog,
                &selection.profile,
                stop.clone(),
            )
            .await?;
            admission.reserve(&request.id)?;
            let environment = [
                "DOTNET_ROOT",
                "HOME",
                "XDG_CONFIG_HOME",
                "XDG_CACHE_HOME",
                "CODEX_HOME",
                "PI_CODING_AGENT_DIR",
            ]
            .into_iter()
            .filter_map(|key| std::env::var_os(key).map(|value| (key.into(), Some(value))))
            .collect();
            let supervisor = NativeCommand {
                binary: std::env::current_exe()
                    .map_err(|_| invalid("VM supervisor requires its installed fleetd executable"))?
                    .into_os_string(),
                arguments: vec![supervisor::MODE.into(), request.file()?.into_os_string()],
                workspace: directory.clone(),
                environment,
                input: true,
            };
            let service = resources::service(
                &configuration.directory,
                &request.id,
                selection.catalog.memory_budget_mib,
                &selection.profile,
                &supervisor,
            )?;
            let session = Session::start(request, service)?;
            // Once its controller exists, only confirmed service teardown may
            // remove its files. A failed close must retain scratch and fence.
            files_owned = false;
            if let Err(error) = session.expect(false, 30, stop.clone()).await {
                session.close().await?;
                return Err(error);
            }
            session
        };
        if let Err(error) = session.expect(true, 240, stop.clone()).await {
            session.close().await?;
            return Err(error);
        }
        let execution = session.execution.clone();
        Ok(NativeLease::new(execution, move || async move {
            session.close().await
        }))
    }
    .await;
    if started.is_err() && files_owned && directory.exists() {
        super::execution_files::remove(&id)?;
    }
    started
}
impl Session {
    fn start(request: Request, service: NativeCommand) -> Result<Self> {
        let mut process = NativeProcess::start(&service)?;
        let mut input = process.input()?;
        let output = process.output()?;
        let errors = process.errors()?;
        let tail = Arc::new(Mutex::new(String::new()));
        let errors = tokio::spawn(helpers::drain(errors, tail.clone()));
        let stop = CancellationToken::new();
        let stopping = stop.clone();
        let (published, state) = watch::channel(State::Starting);
        let stages = published.clone();
        let expected_id = request.id.clone();
        let output = tokio::spawn(async move {
            let mut lines = tokio::io::BufReader::new(output).lines();
            let mut admitted = false;
            let mut ready = false;
            let mut failed = false;
            while let Some(line) = lines
                .next_line()
                .await
                .map_err(|_| invalid("Cannot read VM supervisor status"))?
            {
                if line.len() > 65536 {
                    return Err(invalid("VM supervisor status exceeds its bound"));
                }
                let value: serde_json::Value = serde_json::from_str(&line)
                    .map_err(|_| invalid("Invalid VM supervisor status JSON"))?;
                let phase = value["state"]
                    .as_str()
                    .ok_or_else(|| invalid("Missing VM supervisor status"))?;
                let fields = if phase == "failed" {
                    vec!["id", "state", "error"]
                } else {
                    vec!["id", "state"]
                };
                crossfire_contracts::validation::object(&value, &fields, &[])?;
                if value["id"].as_str() != Some(&expected_id) {
                    return Err(invalid("Invalid VM supervisor status identity"));
                }
                match phase {
                    "admitted" if !admitted && !ready && !failed => {
                        admitted = true;
                        stages.send_replace(State::Admitted);
                    }
                    "ready" if admitted && !ready && !failed => {
                        ready = true;
                        stages.send_replace(State::Ready);
                    }
                    "failed" if admitted && !failed => {
                        failed = true;
                        stages.send_replace(State::Failed(invalid(
                            value["error"]
                                .as_str()
                                .ok_or_else(|| invalid("Invalid VM supervisor failure"))?,
                        )));
                    }
                    _ => return Err(invalid("Invalid VM supervisor status sequence")),
                }
            }
            Ok::<(), crossfire_kernel::Failure>(())
        });
        let descriptor = SshExecution {
            directory: request.directory.clone(),
            id: request.id.clone(),
        };
        let execution = execution(descriptor);
        tokio::spawn(async move {
            let finished = async {
                tokio::select! { biased; _=stopping.cancelled()=>{
                    let _closed=input.write_all(b"close\n").await; let _flushed=input.flush().await; drop(input);
                    match tokio::time::timeout(Duration::from_secs(30),process.wait()).await {
                        Ok(result)=>result?,
                        Err(_)=>{
                            let result=capture(&NativeCommand {binary:"/usr/bin/systemctl".into(),arguments:vec!["--user".into(),"stop".into(),request.unit().into()],workspace:request.directory.clone(),environment:BTreeMap::new(),input:false},8192,Duration::from_secs(30),CancellationToken::new()).await?;
                            if !result.status.success() {return Err(invalid("Cannot stop the exact VM service; ownership remains fenced"));}
                            tokio::time::timeout(Duration::from_secs(10),process.wait()).await.map_err(|_| invalid("VM service did not finish teardown"))??
                        }
                    }
                }, result=process.wait()=>result? };
                output.await.map_err(|_| invalid("VM supervisor status observer failed"))??;
                errors.await.map_err(|_| invalid("VM supervisor diagnostic observer failed"))??;
                execution_state::remove_closed(&request.native.directory,&request.id)?;
                budget::remove(&fleetd_storage::vm_budget::directory(&request.fleet)?,&request.id)?;
                for path in [request.ready(),request.ready().with_file_name(format!("{}.close",request.ready().file_name().and_then(|file| file.to_str()).ok_or_else(|| invalid("Invalid VM readiness path"))?))] {
                    let parent=path.parent().ok_or_else(|| invalid("Invalid VM readiness directory"))?;
                    PrivateDirectory::open(parent,false)?.remove(path.file_name().and_then(|file| file.to_str()).ok_or_else(|| invalid("Invalid VM readiness filename"))?)?;
                }
                super::execution_files::remove(&request.id)?;
                Ok(())
            }.await;
            published.send_replace(State::Closed(
                finished,
                tail.lock().map(|value| value.clone()).unwrap_or_default(),
            ));
        });
        Ok(Self {
            stop,
            state,
            execution,
        })
    }
    async fn expect(&self, ready: bool, seconds: u64, stop: CancellationToken) -> Result<()> {
        let mut state = self.state.clone();
        let waiting = async {
            loop {
                match state.borrow().clone() {
                    State::Ready => return Ok(()),
                    State::Admitted if !ready => return Ok(()),
                    State::Failed(error) => return Err(error),
                    State::Closed(result, diagnostic) => {
                        return result.and(Err(invalid(&format!(
                            "VM supervisor ended before readiness: {diagnostic}"
                        ))));
                    }
                    _ => {}
                }
                state
                    .changed()
                    .await
                    .map_err(|_| invalid("VM supervisor status ended"))?;
            }
        };
        tokio::select! { biased; _=stop.cancelled()=>Err(invalid("VM startup cancelled")), result=tokio::time::timeout(Duration::from_secs(seconds),waiting)=>result.map_err(|_| invalid("VM startup deadline exceeded"))? }
    }
    async fn close(&self) -> Result<()> {
        self.stop.cancel();
        let mut state = self.state.clone();
        loop {
            let current = state.borrow().clone();
            if let State::Closed(result, _) = current {
                return result;
            }
            state
                .changed()
                .await
                .map_err(|_| invalid("VM cleanup ended without confirmation"))?;
        }
    }
}
impl Drop for Session {
    fn drop(&mut self) {
        self.stop.cancel();
    }
}
fn execution(descriptor: SshExecution) -> NativeExecution {
    let command = descriptor.clone();
    let endpoint = descriptor.clone();
    let ports = Arc::new(AsyncMutex::new(BTreeMap::new()));
    NativeExecution {
        command: Arc::new(move |native| {
            ssh_commands::place(&command.directory, &command.id, native)
        }),
        ssh: Some(descriptor),
        endpoint: Arc::new(move |endpoint_url, stop| {
            let endpoint = endpoint.clone();
            let ports = ports.clone();
            Box::pin(async move {
                let port = endpoint_url
                    .strip_prefix("ws://127.0.0.1:")
                    .and_then(|value| value.parse::<u16>().ok())
                    .filter(|port| *port > 0)
                    .ok_or_else(|| {
                        invalid("Native VM endpoint must be its own loopback WebSocket port")
                    })?;
                let mut ports = ports.lock().await;
                if let Some(local) = ports.get(&port) {
                    return Ok(format!("ws://127.0.0.1:{local}"));
                }
                for _ in 0..3 {
                    let probe = std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
                        .map_err(|_| invalid("Cannot allocate native endpoint port"))?;
                    let local = probe
                        .local_addr()
                        .map_err(|_| invalid("Cannot inspect native endpoint port"))?
                        .port();
                    drop(probe);
                    let forwarded = capture(
                        &ssh_commands::forward(&endpoint.directory, &endpoint.id, local, port)?,
                        8192,
                        Duration::from_secs(10),
                        stop.clone(),
                    )
                    .await?;
                    if forwarded.status.success() {
                        ports.insert(port, local);
                        return Ok(format!("ws://127.0.0.1:{local}"));
                    }
                }
                Err(invalid("Cannot forward the exact guest native endpoint"))
            })
        }),
    }
}
