use crate::{configuration, host};
use crossfire_adapter_filesystem::PrivateDirectory;
use crossfire_adapter_matrix::{homeserver::Homeserver, settings};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use std::{
    net::{Ipv4Addr, SocketAddr},
    path::{Path, PathBuf},
};
use tokio_util::sync::CancellationToken;
fn failed(message: &str) -> Failure {
    Failure::new(ErrorCode::Unavailable, message)
}
pub async fn run(stop: CancellationToken) -> Result<()> {
    let directory = PathBuf::from("/runtime");
    PrivateDirectory::open(&directory, false)?;
    let config = configuration::load(&directory)?;
    crossfire_adapter_sqlite::store::Store::open(&directory.join("management.sqlite"))?;
    let native = settings::read(&config.messaging, &config.instance, &config.administrator)?;
    let log = host::diagnostics(&directory)?;
    let mut homeserver = Homeserver::start(
        &native,
        &directory,
        Path::new("/usr/local/bin/conduit"),
        log.clone(),
        stop.clone(),
    )
    .await?;
    let serving = async {
        let releases =
            crossfire_adapter_filesystem::assets::Directory::open(Path::new("/app/onboarding"))?
                .names(2)?;
        if releases.len() != 1 {
            return Err(failed(
                "Image requires exactly one approved onboarding release",
            ));
        }
        let input = host::Input {
            directory: directory.clone(),
            release: PathBuf::from("/app/onboarding").join(&releases[0]),
            web: "/app/web".into(),
            element: "/app/element".into(),
            public: SocketAddr::from((Ipv4Addr::UNSPECIFIED, 8080)),
            content: SocketAddr::from((Ipv4Addr::UNSPECIFIED, 8082)),
        };
        host::run(input, stop.clone(), log.clone()).await
    };
    tokio::pin!(serving);
    let result = tokio::select! { biased; value=&mut serving=>value, ended=homeserver.wait()=>{
        stop.cancel(); let serving = serving.await; ended?; serving?; Err(failed("Homeserver stopped unexpectedly"))
    }};
    stop.cancel();
    let closed = homeserver.close().await;
    log.close();
    result.and(closed)
}
