use crate::{account::Configuration, settings::READINESS_PATH};
use crossfire_adapter_filesystem::{PrivateDirectory, logging::Store};
use crossfire_adapter_http::{JsonLimits, NativeHttp};
use crossfire_adapter_process::{NativeCommand, NativeProcess};
use crossfire_kernel::{Failure, Result, failure::ErrorCode, identity};
use serde_json::json;
use std::{
    collections::BTreeMap, os::unix::fs::PermissionsExt, path::Path, sync::Arc, time::Duration,
};
use tokio::{
    io::{AsyncRead, AsyncReadExt},
    task::JoinSet,
};
use tokio_util::sync::CancellationToken;

fn failed(message: &str) -> Failure {
    Failure::new(ErrorCode::Unavailable, message)
}
pub struct Homeserver {
    process: NativeProcess,
    streams: JoinSet<Result<()>>,
    _configuration: tempfile::TempDir,
}
async fn pump(mut stream: impl AsyncRead + Unpin, log: Arc<Store>) -> Result<()> {
    let mut bytes = [0; 8192];
    loop {
        let count = stream
            .read(&mut bytes)
            .await
            .map_err(|_| failed("Homeserver diagnostic stream failed"))?;
        if count == 0 {
            return Ok(());
        }
        log.write(
            identity::now()?,
            &format!("Matrix: {}", String::from_utf8_lossy(&bytes[..count])),
        )?;
    }
}
impl Homeserver {
    pub async fn start(
        configuration: &Configuration,
        directory: &Path,
        binary: &Path,
        log: Arc<Store>,
        stop: CancellationToken,
    ) -> Result<Self> {
        if configuration.origin != "http://127.0.0.1:6167/" {
            return Err(failed(
                "Bundled Matrix requires its private loopback origin",
            ));
        }
        PrivateDirectory::open(directory, false)?.child("matrix", true)?;
        let temporary = tempfile::Builder::new()
            .prefix("crossfire-homeserver-")
            .permissions(std::fs::Permissions::from_mode(0o700))
            .tempdir()
            .map_err(|_| failed("Cannot prepare private homeserver configuration"))?;
        let settings = [
            ("server_name", json!(configuration.server_name)),
            ("database_path", json!(directory.join("matrix"))),
            ("database_backend", json!("rocksdb")),
            ("address", json!("127.0.0.1")),
            ("port", json!(6167)),
            ("max_request_size", json!(20971520)),
            ("allow_registration", json!(true)),
            (
                "registration_token",
                json!(configuration.registration_secret.expose()),
            ),
            ("jwt_secret", json!(configuration.jwt_secret.expose())),
            ("allow_room_creation", json!(true)),
            ("allow_federation", json!(false)),
            ("allow_encryption", json!(false)),
            ("allow_check_for_updates", json!(false)),
            ("trusted_servers", json!([])),
            ("log", json!("warn")),
        ];
        let text = "[global]\n".to_owned()
            + &settings
                .iter()
                .map(|(name, value)| format!("{name} = {value}\n"))
                .collect::<String>();
        PrivateDirectory::open(temporary.path(), false)?
            .write_atomic("conduit.toml", text.as_bytes())?;
        let mut process = NativeProcess::start(&NativeCommand {
            binary: binary.to_owned().into_os_string(),
            arguments: vec![],
            workspace: directory.to_owned(),
            environment: BTreeMap::from([(
                "CONDUIT_CONFIG".into(),
                Some(temporary.path().join("conduit.toml").into_os_string()),
            )]),
            input: false,
        })?;
        let mut streams = JoinSet::new();
        streams.spawn(pump(process.output()?, log.clone()));
        streams.spawn(pump(process.errors()?, log));
        let mut owned = Self {
            process,
            streams,
            _configuration: temporary,
        };
        if let Err(error) = owned.ready(&configuration.origin, stop).await {
            owned.close().await?;
            return Err(error);
        }
        Ok(owned)
    }
    async fn ready(&mut self, origin: &str, stop: CancellationToken) -> Result<()> {
        let http = NativeHttp::new(origin, stop.clone())?;
        let mut tick = tokio::time::interval(Duration::from_millis(100));
        let end = tokio::time::Instant::now() + Duration::from_secs(60);
        loop {
            tokio::select! {biased; _=stop.cancelled()=>return Err(failed("Homeserver startup cancelled")), ended=self.process.wait()=>{ended?;return Err(failed("Homeserver exited before readiness"));}, _=tokio::time::sleep_until(end)=>return Err(failed("Homeserver readiness deadline exceeded")), _=tick.tick()=>{} }
            if let Ok(response) = http
                .json(
                    None,
                    hyper::Method::GET,
                    READINESS_PATH,
                    None,
                    JsonLimits {
                        timeout: Duration::from_secs(1),
                        ..JsonLimits::default()
                    },
                )
                .await
                && response.status == 200
            {
                return Ok(());
            }
        }
    }
    pub async fn wait(&mut self) -> Result<()> {
        self.process.wait().await.map(|_| ())
    }
    pub async fn close(&mut self) -> Result<()> {
        let closed = self.process.stop().await.map(|_| ());
        let mut streams = Ok(());
        while let Some(value) = self.streams.join_next().await {
            match value {
                Ok(Ok(())) => {}
                Ok(Err(error)) => streams = Err(error),
                Err(_) => streams = Err(failed("Homeserver diagnostic owner failed")),
            }
        }
        closed.and(streams)
    }
}
