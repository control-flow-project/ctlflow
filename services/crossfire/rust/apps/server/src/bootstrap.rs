use crate::configuration::Configuration;
use crossfire_adapter_filesystem::PrivateDirectory;
use crossfire_adapter_http::NativeHttp;
use crossfire_adapter_matrix::account::Authority;
use crossfire_contracts::origin::segment;
use crossfire_contracts::validation as check;
use crossfire_kernel::{Failure, Result, failure::ErrorCode, secret::Secret};
use hyper::Method;
use std::path::Path;
use tokio_util::sync::CancellationToken;

pub struct Credentials {
    service: Secret,
    administrator: Secret,
}
pub fn load(directory: &Path) -> Result<Credentials> {
    let directory = PrivateDirectory::open(directory, false)?;
    let bytes = directory.read("bootstrap.json", 65536)?;
    let value = serde_json::from_slice(&bytes)
        .map_err(|_| Failure::new(ErrorCode::Invalid, "Invalid private bootstrap credentials"))?;
    let value = check::object(&value, &["servicePassword", "administratorPassword"], &[])?;
    Ok(Credentials {
        service: Secret::new(check::text(&value["servicePassword"], 32, 1024)?.to_owned()),
        administrator: Secret::new(
            check::text(&value["administratorPassword"], 12, 1024)?.to_owned(),
        ),
    })
}
pub async fn apply(
    configuration: &Configuration,
    credentials: &Credentials,
    matrix: &Authority,
    stop: CancellationToken,
) -> Result<()> {
    let service = matrix
        .provision(
            &configuration.service_matrix_id(),
            &credentials.service,
            "CROSSFIRE_CONTROL",
        )
        .await?;
    let http = NativeHttp::new(configuration.matrix_origin.as_str(), stop)?;
    let path = format!(
        "/_matrix/client/v3/directory/room/{}",
        segment(&format!("#admins:{}", configuration.server_name))
    );
    let room = http
        .ok(Some(&service.access_token), Method::GET, &path, None)
        .await?;
    let room = check::room_id(&room["room_id"])
        .map_err(|_| Failure::new(ErrorCode::Native, "Native administrator room is missing"))?;
    let members = http
        .ok(
            Some(&service.access_token),
            Method::GET,
            &format!("/_matrix/client/v3/rooms/{}/joined_members", segment(&room)),
            None,
        )
        .await?;
    if members
        .get("joined")
        .and_then(|value| value.as_object())
        .is_none_or(|members| !members.contains_key(&configuration.service_matrix_id()))
    {
        return Err(Failure::new(
            ErrorCode::Native,
            "The private service identity must be the first native administrator; refusing adoption of another homeserver",
        ));
    }
    if !matrix.exists(&configuration.administrator).await? {
        matrix
            .provision(
                &configuration.administrator,
                &credentials.administrator,
                "CROSSFIRE_HUMAN",
            )
            .await?;
    }
    Ok(())
}
