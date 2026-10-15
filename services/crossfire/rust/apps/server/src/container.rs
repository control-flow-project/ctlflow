use crate::{configuration, host};
use crossfire_adapter_filesystem::{PrivateDirectory, logging::Store};
use crossfire_adapter_http::{JsonLimits, NativeHttp};
use crossfire_adapter_process::{NativeCommand, NativeProcess};
use crossfire_kernel::{Failure, Result, failure::ErrorCode, identity};
use serde_json::json;
use std::{
    collections::BTreeMap,
    net::{Ipv4Addr, SocketAddr},
    os::unix::fs::PermissionsExt,
    path::PathBuf,
    sync::Arc,
    time::Duration,
};
use tokio::{
    io::{AsyncRead, AsyncReadExt},
    task::JoinSet,
};
use tokio_util::sync::CancellationToken;

fn failed(message: &str) -> Failure {
    Failure::new(ErrorCode::Unavailable, message)
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
pub async fn run(stop: CancellationToken) -> Result<()> {
    let directory = PathBuf::from("/runtime");
    let private = PrivateDirectory::open(&directory, false)?;
    let config = configuration::load(&directory)?;
    if config.matrix_origin.as_str() != "http://127.0.0.1:6167/" {
        return Err(failed(
            "Bundled Matrix requires its private loopback origin",
        ));
    }
    crossfire_adapter_sqlite::store::Store::open(&directory.join("management.sqlite"))?;
    private.child("matrix", true)?;
    let temporary = tempfile::Builder::new()
        .prefix("crossfire-homeserver-")
        .permissions(std::fs::Permissions::from_mode(0o700))
        .tempdir()
        .map_err(|_| failed("Cannot prepare private homeserver configuration"))?;
    let path = temporary.path().join("conduit.toml");
    let settings = [
        ("server_name", json!(config.server_name)),
        ("database_path", json!(directory.join("matrix"))),
        ("database_backend", json!("rocksdb")),
        ("address", json!("127.0.0.1")),
        ("port", json!(6167)),
        ("max_request_size", json!(20971520)),
        ("allow_registration", json!(true)),
        (
            "registration_token",
            json!(config.registration_secret.expose()),
        ),
        ("jwt_secret", json!(config.jwt_secret.expose())),
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
    let log = host::diagnostics(&directory)?;
    let mut process = NativeProcess::start(&NativeCommand {
        binary: "/usr/local/bin/conduit".into(),
        arguments: vec![],
        workspace: directory.clone(),
        environment: BTreeMap::from([("CONDUIT_CONFIG".into(), Some(path.into_os_string()))]),
        input: false,
    })?;
    let mut tasks = JoinSet::new();
    tasks.spawn(pump(process.output()?, log.clone()));
    tasks.spawn(pump(process.errors()?, log.clone()));
    let startup=async {
        let http=NativeHttp::new(config.matrix_origin.as_str(),stop.clone())?;
        let mut tick=tokio::time::interval(Duration::from_millis(100));
        let end=tokio::time::Instant::now()+Duration::from_secs(60);
        loop{
            tokio::select!{biased;_=stop.cancelled()=>return Err(failed("Homeserver startup cancelled")),ended=process.wait()=>{ended?;return Err(failed("Homeserver exited before readiness"));},_=tokio::time::sleep_until(end)=>return Err(failed("Homeserver readiness deadline exceeded")),_=tick.tick()=>{}}
            if let Ok(response)=http.json(None,hyper::Method::GET,"/_matrix/client/versions",None,JsonLimits{timeout:Duration::from_secs(1),..JsonLimits::default()}).await && response.status==200 {break;}
        }
        let releases=crossfire_adapter_filesystem::assets::Directory::open(std::path::Path::new("/app/onboarding"))?.names(2)?;
        if releases.len()!=1{return Err(failed("Image requires exactly one approved onboarding release"));}
        let input=host::Input{directory:directory.clone(),release:PathBuf::from("/app/onboarding").join(&releases[0]),web:"/app/web".into(),element:"/app/element".into(),public:SocketAddr::from((Ipv4Addr::UNSPECIFIED,8080)),content:SocketAddr::from((Ipv4Addr::UNSPECIFIED,8082))};
        let serving=host::run(input,stop.clone(),log.clone());tokio::pin!(serving);
        tokio::select!{biased;value=&mut serving=>value,ended=process.wait()=>{ended?;stop.cancel();serving.await?;Err(failed("Homeserver stopped unexpectedly"))}}
    }.await;
    stop.cancel();
    let closed = process.stop().await;
    let mut streams = Ok(());
    while let Some(value) = tasks.join_next().await {
        match value {
            Ok(Ok(())) => {}
            Ok(Err(error)) => {
                streams = Err(error);
            }
            Err(_) => {
                streams = Err(failed("Homeserver diagnostic owner failed"));
            }
        }
    }
    log.close();
    startup.and(closed.map(|_| ())).and(streams)
}
