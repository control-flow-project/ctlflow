use crate::api;
use crossfire_adapter_codex::owned::CodexRuntime;
use crossfire_adapter_filesystem::{
    PrivateDirectory, lock::StateLock, logging::Store, socket::Socket,
};
use crossfire_adapter_http::server::{self, Limits, Listener};
use crossfire_adapter_pi::owned::PiRuntime;
use crossfire_contracts::{enrollment, validation as check};
use crossfire_kernel::{Failure, Result, failure::ErrorCode, identity};
use fleetd_adapter_execution::{
    host::{Clock, Host},
    native::Adapter,
};
use fleetd_domain::{controller::Controller, controller_model::ControllerIdentity};
use fleetd_storage::registry::Registry;
use serde_json::{Value, json};
use std::{collections::BTreeMap, path::PathBuf, sync::Arc, time::Duration};
use tokio::{
    signal::unix::{SignalKind, signal},
    task::JoinHandle,
};
use tokio_util::sync::CancellationToken;

pub type ControllerOwner = Controller<Registry, Host, Clock>;
pub struct Input {
    pub root: PathBuf,
    pub name: Option<String>,
    pub artifacts: PathBuf,
    pub background: bool,
    pub migrate: bool,
}
fn invalid(message: &str) -> Failure {
    Failure::new(ErrorCode::Invalid, message)
}
pub fn arguments(values: &[String]) -> Result<Input> {
    let mut arguments = BTreeMap::new();
    let mut background = false;
    let mut migrate = false;
    let mut index = 0;
    while index < values.len() {
        let key = &values[index];
        match key.as_str() {
            "--background" if !background => background = true,
            "--migrate-contexts" if !migrate => migrate = true,
            "--root" | "--name" | "--artifacts" if index + 1 < values.len() => {
                index += 1;
                if arguments
                    .insert(key.as_str(), values[index].as_str())
                    .is_some()
                {
                    return Err(invalid("Repeated fleetd option"));
                }
            }
            _ => {
                return Err(invalid(
                    "fleetd --root ABSOLUTE_DIRECTORY [--name NAME] [--artifacts RELEASE_DIRECTORY] [--background] [--migrate-contexts]",
                ));
            }
        }
        index += 1;
    }
    let root = PathBuf::from(
        arguments
            .get("--root")
            .ok_or_else(|| invalid("Select an absolute controller root"))?,
    );
    if !fleetd_contracts::configuration::absolute_path(
        root.to_str()
            .ok_or_else(|| invalid("Invalid controller root"))?,
    ) {
        return Err(invalid("Controller root must be absolute and normalized"));
    }
    let name = arguments.get("--name").map(|value| value.to_string());
    if let Some(name) = &name {
        check::plain_text(&json!(name), 100)?;
        if name.is_empty() {
            return Err(invalid("Controller name is empty"));
        }
    }
    if migrate && (background || name.is_some() || arguments.contains_key("--artifacts")) {
        return Err(invalid(
            "Context migration requires only --root and --migrate-contexts",
        ));
    }
    let artifacts = match arguments.get("--artifacts") {
        Some(directory) => PathBuf::from(directory),
        None => std::env::current_exe()
            .map_err(|_| invalid("Executable location unavailable"))?
            .parent()
            .ok_or_else(|| invalid("Executable parent unavailable"))?
            .join("artifacts"),
    };
    if !artifacts.is_absolute() {
        return Err(invalid("Select an absolute approved artifact directory"));
    }
    Ok(Input {
        root,
        name,
        artifacts,
        background,
        migrate,
    })
}
pub async fn signals(stop: CancellationToken) -> Result<()> {
    let mut interrupt = signal(SignalKind::interrupt())
        .map_err(|_| invalid("Cannot register interrupt handling"))?;
    let mut terminate = signal(SignalKind::terminate())
        .map_err(|_| invalid("Cannot register termination handling"))?;
    let mut hangup =
        signal(SignalKind::hangup()).map_err(|_| invalid("Cannot register hangup handling"))?;
    tokio::select! { _=stop.cancelled()=>{}, _=interrupt.recv()=>stop.cancel(), _=terminate.recv()=>stop.cancel(), _=hangup.recv()=>stop.cancel() };
    Ok(())
}
fn controller(value: &Value) -> Result<ControllerIdentity> {
    let parsed = enrollment::controller(value)?;
    Ok(ControllerIdentity {
        name: parsed.name,
        metadata: value.get("metadata").map(|_| parsed.metadata),
    })
}
pub async fn run(input: Input, stop: CancellationToken) -> Result<()> {
    if input.background {
        crossfire_adapter_process::background::redirect()?;
    }
    let private = PrivateDirectory::open(&input.root, true)?;
    let authentication_key =
        fleetd_storage::authentication::initialize(&fleetd_storage::authentication::file_path()?)
            .await?;
    let _ownership = StateLock::acquire(&input.root.join("daemon"))?;
    let selected = private
        .read_optional("controller.json", 65536)?
        .map(|bytes| {
            serde_json::from_slice::<Value>(&bytes)
                .map_err(|_| invalid("Invalid controller identity"))
        })
        .transpose()?;
    let identity = match selected {
        Some(value) => {
            let identity = controller(&value)?;
            if input
                .name
                .as_ref()
                .is_some_and(|name| name != &identity.name)
            {
                return Err(invalid("Controller root is already named differently"));
            }
            identity
        }
        None => {
            let identity =
                controller(&json!({"name":input.name.unwrap_or_else(|| "local".to_owned())}))?;
            private.write_new(
                "controller.json",
                &serde_json::to_vec(&fleetd_contracts::wire::controller(&identity))
                    .map_err(|_| invalid("Cannot encode controller identity"))?,
            )?;
            identity
        }
    };
    let registry = Arc::new(Registry::open(&input.root)?);
    if input.migrate {
        return crate::migration::run(&input.root, registry.as_ref()).await;
    }
    let configured = private
        .read_optional("config.json", 65536)?
        .map(|bytes| {
            serde_json::from_slice::<Value>(&bytes)
                .map_err(|_| invalid("Invalid logging configuration"))
        })
        .transpose()?
        .unwrap_or(json!({}));
    let configured = check::object(&configured, &[], &["loggingRetentionDays"])?;
    let days = configured
        .get("loggingRetentionDays")
        .map(|value| check::integer(value, 1, check::SAFE_INTEGER / 86_400_000))
        .transpose()?
        .unwrap_or(7);
    let diagnostics = Arc::new(Store::new(&input.root.join("logs"), days)?);
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or_else(|| invalid("HOME is required for native credentials"))?;
    let adapters = BTreeMap::from([
        (
            "codex".to_owned(),
            Arc::new(Adapter::Codex(CodexRuntime {
                binary: "codex".into(),
                host_home: std::env::var_os("CODEX_HOME")
                    .map(PathBuf::from)
                    .unwrap_or_else(|| home.join(".codex")),
            })),
        ),
        (
            "pi".to_owned(),
            Arc::new(Adapter::Pi(PiRuntime {
                binary: "pi".into(),
                host_home: std::env::var_os("PI_CODING_AGENT_DIR")
                    .map(PathBuf::from)
                    .unwrap_or_else(|| home.join(".pi/agent")),
            })),
        ),
    ]);
    let log = diagnostics.clone();
    let foreground = !input.background;
    let execution = Arc::new(Host::new(
        adapters,
        input.artifacts,
        Arc::new(move |message| {
            if foreground {
                eprintln!("{message}");
            }
            if let Err(error) = log.write(identity::now().unwrap_or(0), message) {
                eprintln!("{}", error.message);
            }
        }),
        identity::now as Clock,
    )?);
    let controller = Controller::open(
        registry,
        execution.clone(),
        identity,
        identity::now as Clock,
    )?;
    let socket = Socket::prepare(&input.root.join("fleetd.sock"))?;
    socket.remove_stale().await?;
    let listener = server::private_unix(&input.root.join("fleetd.sock"))?;
    let socket_owner = socket.claim()?;
    let state = Arc::new(api::State {
        authentication_key,
        controller: controller.clone(),
        diagnostics: diagnostics.clone(),
        days,
        stop: stop.clone(),
    });
    let maintenance_stop = stop.child_token();
    let maintenance = maintain(
        controller.clone(),
        diagnostics.clone(),
        days,
        maintenance_stop.clone(),
    );
    println!(
        "{}",
        json!({"status":"ready","controller":fleetd_contracts::wire::controller(&controller.identity),"socket":input.root.join("fleetd.sock")})
    );
    let result = server::serve(
        Listener::Unix(listener),
        state,
        api::handle,
        Limits {
            connections: 128,
            idle: Duration::from_secs(10),
            request: Duration::from_secs(120),
        },
        stop.clone(),
    )
    .await;
    maintenance_stop.cancel();
    let maintained = maintenance
        .await
        .map_err(|_| invalid("Logging maintenance task failed"))?;
    let closed = controller.close().await;
    let transport = execution.close().await;
    socket_owner.remove()?;
    result.and(maintained).and(closed).and(transport)
}
fn maintain(
    controller: Arc<ControllerOwner>,
    diagnostics: Arc<Store>,
    days: i64,
    stop: CancellationToken,
) -> JoinHandle<Result<()>> {
    tokio::spawn(async move {
        let mut delay = Duration::ZERO;
        loop {
            tokio::select! { biased; _=stop.cancelled()=>return Ok(()),_=tokio::time::sleep(delay)=>{} }
            let result = diagnostics
                .maintain(identity::now()?)
                .and_then(|_| controller.maintain_history(days));
            diagnostics
                .maintenance_error(result.as_ref().err().map(|error| error.message.as_str()))?;
            delay = if result.as_ref().is_err() || result == Ok(true) {
                Duration::from_secs(5)
            } else {
                Duration::from_secs(3600)
            };
        }
    })
}
