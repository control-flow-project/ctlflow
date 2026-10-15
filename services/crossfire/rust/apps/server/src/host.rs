use crate::{
    application, assets::Assets, bootstrap, configuration, content, registration::Registration,
    security::RateLimit, state::State, worker,
};
use crossfire_adapter_filesystem::{
    PrivateDirectory, lock::StateLock, logging, publication, release,
};
use crossfire_adapter_http::{
    NativeHttp,
    server::{self, Limits, Listener},
};
use crossfire_adapter_matrix::{
    account::{Authority, Configuration},
    room_operations::Operations,
};
use crossfire_adapter_sqlite::store::{SharedStore, Store};
use crossfire_contracts::enrollment::Digest;
use crossfire_domain::{port::RepositoryAccess, registration};
use crossfire_kernel::{Failure, Result, failure::ErrorCode, identity};
use std::{
    net::{Ipv4Addr, SocketAddr},
    path::PathBuf,
    sync::Arc,
    time::Duration,
};
use tokio::{
    net::TcpListener,
    signal::unix::{SignalKind, signal},
    sync::{Notify, Semaphore},
    task::JoinSet,
};
use tokio_util::sync::CancellationToken;

pub struct Input {
    pub directory: PathBuf,
    pub release: PathBuf,
    pub web: PathBuf,
    pub element: PathBuf,
    pub public: SocketAddr,
    pub content: SocketAddr,
}
fn invalid(message: &str) -> Failure {
    Failure::new(ErrorCode::Invalid, message)
}
pub fn arguments(values: &[String]) -> Result<Input> {
    if !(5..=7).contains(&values.len()) || values[0] != "serve" {
        return Err(invalid(
            "Use serve <private-state-directory> <release-directory> <shared-web-directory> <element-directory> [port] [content-port]",
        ));
    }
    let current = std::env::current_dir().map_err(|_| invalid("Working directory unavailable"))?;
    let path = |value: &str| {
        if std::path::Path::new(value).is_absolute() {
            PathBuf::from(value)
        } else {
            current.join(value)
        }
    };
    let port = |value: Option<&String>, default: u16| -> Result<u16> {
        let selected = value
            .map(|value| {
                value
                    .parse::<u16>()
                    .map_err(|_| invalid("Invalid listener port"))
            })
            .transpose()?
            .unwrap_or(default);
        if selected < 1024 {
            Err(invalid("Listener port must be within 1024..65535"))
        } else {
            Ok(selected)
        }
    };
    let public = port(values.get(5), 8080)?;
    let content = port(values.get(6), 8082)?;
    if public == content {
        return Err(invalid(
            "Content port must be separate from the application port",
        ));
    }
    Ok(Input {
        directory: path(&values[1]),
        release: path(&values[2]),
        web: path(&values[3]),
        element: path(&values[4]),
        public: (Ipv4Addr::LOCALHOST, public).into(),
        content: (Ipv4Addr::LOCALHOST, content).into(),
    })
}
pub fn diagnostics(directory: &std::path::Path) -> Result<Arc<logging::Store>> {
    Ok(Arc::new(logging::Store::new(
        &directory.join("management.sqlite.logs"),
        configuration::load(directory)?.logging_retention_days,
    )?))
}
pub async fn run(
    input: Input,
    stop: CancellationToken,
    diagnostics: Arc<logging::Store>,
) -> Result<()> {
    let directory = PrivateDirectory::open(&input.directory, false)?;
    let _ownership = StateLock::acquire(&input.directory.join("management.sqlite.owner"))?;
    directory.prepared_database("management.sqlite")?;
    let repository = SharedStore::new(Store::open(&input.directory.join("management.sqlite"))?);
    let configuration = configuration::load(&input.directory)?;
    let release = release::load(&input.release)?;
    let assets = Assets::load(
        &input.web,
        &input.element,
        configuration
            .public_origin
            .host_str()
            .ok_or_else(|| invalid("Public hostname required"))?,
    )?;
    let credentials = bootstrap::load(&input.directory)?;
    let matrix = Authority::new(Configuration {
        origin: configuration.matrix_origin.to_string(),
        server_name: configuration.server_name.clone(),
        jwt_secret: configuration.jwt_secret.clone(),
        registration_secret: configuration.registration_secret.clone(),
        service_matrix_id: configuration.service_matrix_id(),
    })?;
    bootstrap::apply(&configuration, &credentials, &matrix, stop.child_token()).await?;
    repository.with(|repo| {
        registration::initialize(repo, &configuration.administrator, identity::now()?)
    })?;
    let public = TcpListener::bind(input.public).await.map_err(|_| {
        Failure::new(
            ErrorCode::Unavailable,
            "Application listener could not bind",
        )
    })?;
    let content = TcpListener::bind(input.content)
        .await
        .map_err(|_| Failure::new(ErrorCode::Unavailable, "Content listener could not bind"))?;
    let state = Arc::new(State {
        matrix_proxy: NativeHttp::new(configuration.matrix_origin.as_str(), stop.child_token())?,
        publications: publication::Store::open(
            &input.directory.join("management.sqlite.publications"),
            configuration.publication_budget.uploads,
        )?,
        public_reads: Arc::new(Semaphore::new(32)),
        diagnostics,
        configuration,
        repository,
        matrix,
        room_operations: Operations::default(),
        release,
        assets,
        digest: Digest::new()?,
        started_at: identity::now()?,
        rate: RateLimit::default(),
        registration: Registration::default(),
        changed: Notify::new(),
        stop: stop.clone(),
    });
    let mut tasks = JoinSet::new();
    tasks.spawn(server::serve(
        Listener::Tcp(public),
        Arc::clone(&state),
        application::handle,
        Limits {
            connections: 256,
            idle: Duration::from_secs(120),
            request: Duration::from_secs(120),
        },
        stop.child_token(),
    ));
    tasks.spawn(server::serve(
        Listener::Tcp(content),
        Arc::clone(&state),
        |state, request, _peer| content::handle(state, request),
        Limits {
            connections: 64,
            idle: Duration::from_secs(1),
            request: Duration::from_secs(30),
        },
        stop.child_token(),
    ));
    tasks.spawn(worker::run(Arc::clone(&state)));
    println!(
        "Crossfire ready: {} | Management: {}manage/",
        state.configuration.public_origin, state.configuration.public_origin
    );
    let outcome = tokio::select! { biased;
        _ = stop.cancelled() => Ok(()),
        completed = tasks.join_next() => match completed {
            Some(Ok(Err(error))) => Err(error),
            _ => Err(Failure::new(ErrorCode::Unavailable, "A required server task stopped unexpectedly")),
        },
    };
    stop.cancel();
    state.matrix.close();
    state.room_operations.close();
    state.publications.close();
    while let Some(completed) = tasks.join_next().await {
        if let Ok(Err(error)) = completed {
            let _logged = state.diagnostics.write(
                identity::now()?,
                &format!("Server shutdown: {}", error.code.as_str()),
            );
        }
    }
    outcome
}
pub async fn signals(stop: CancellationToken) -> Result<()> {
    let mut interrupt = signal(SignalKind::interrupt())
        .map_err(|_| Failure::new(ErrorCode::Unavailable, "Signal handler unavailable"))?;
    let mut terminate = signal(SignalKind::terminate())
        .map_err(|_| Failure::new(ErrorCode::Unavailable, "Signal handler unavailable"))?;
    let mut hangup = signal(SignalKind::hangup())
        .map_err(|_| Failure::new(ErrorCode::Unavailable, "Signal handler unavailable"))?;
    tokio::select! { biased; _ = stop.cancelled() => {}, _ = interrupt.recv() => {}, _ = terminate.recv() => {}, _ = hangup.recv() => {} }
    stop.cancel();
    Ok(())
}
