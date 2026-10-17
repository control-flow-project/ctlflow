use crossfire_adapter_filesystem::PrivateDirectory;
use crossfire_contracts::origin;
use crossfire_contracts::validation as check;
use crossfire_domain::publication::values::Budget;
use crossfire_kernel::{Failure, Result, failure::ErrorCode, secret::Secret};
use serde_json::Value;
use std::{net::IpAddr, path::Path};
use url::Url;

pub struct Configuration {
    pub instance: String,
    pub server_name: String,
    pub public_origin: Url,
    pub content_origin: Url,
    pub matrix_origin: Url,
    pub administrator: String,
    pub jwt_secret: Secret,
    pub registration_secret: Secret,
    pub publication_budget: Budget,
    pub logging_retention_days: i64,
    pub trusted_proxy_addresses: Vec<IpAddr>,
}
impl Configuration {
    pub fn service_matrix_id(&self) -> String {
        format!("@crossfire-{}:{}", self.instance, self.server_name)
    }
}
pub fn parse(value: &Value) -> Result<Configuration> {
    let value = check::object(
        value,
        &[
            "instance",
            "serverName",
            "publicOrigin",
            "contentOrigin",
            "matrixOrigin",
            "administrator",
            "jwtSecret",
            "registrationSecret",
        ],
        &[
            "publicationBudget",
            "loggingRetentionDays",
            "trustedProxyAddresses",
        ],
    )?;
    let instance = check::name(&value["instance"])?;
    let server_name = check::text(&value["serverName"], 1, 200)?;
    let (host, port) = server_name
        .split_once(':')
        .map_or((server_name, None), |(host, port)| (host, Some(port)));
    if host.is_empty()
        || !host.bytes().all(|value| {
            value.is_ascii_lowercase() || value.is_ascii_digit() || matches!(value, b'.' | b'-')
        })
        || port.is_some_and(|port| {
            port.is_empty() || !port.bytes().all(|value| value.is_ascii_digit())
        })
    {
        return Err(Failure::new(
            ErrorCode::Invalid,
            "Invalid Matrix server name",
        ));
    }
    let administrator = check::matrix_user_id(&value["administrator"])?;
    if !administrator.ends_with(&format!(":{server_name}")) {
        return Err(Failure::new(
            ErrorCode::Invalid,
            "Administrator must belong to the configured homeserver",
        ));
    }
    let public_origin = origin::parse(check::text(&value["publicOrigin"], 1, 2048)?)?;
    let content_origin = origin::parse(check::text(&value["contentOrigin"], 1, 2048)?)?;
    let matrix_origin = origin::parse(check::text(&value["matrixOrigin"], 1, 2048)?)?;
    if content_origin.origin() == public_origin.origin()
        || content_origin.origin() == matrix_origin.origin()
        || content_origin.scheme() == "https"
            && [public_origin.host_str(), matrix_origin.host_str()]
                .contains(&content_origin.host_str())
    {
        return Err(Failure::new(
            ErrorCode::Invalid,
            "Publications require a separate content hostname and origin",
        ));
    }
    Ok(Configuration {
        instance: instance.to_owned(),
        server_name: server_name.to_owned(),
        public_origin,
        content_origin,
        matrix_origin,
        administrator: administrator.to_owned(),
        jwt_secret: Secret::new(check::text(&value["jwtSecret"], 32, 200)?.to_owned()),
        registration_secret: Secret::new(
            check::text(&value["registrationSecret"], 32, 200)?.to_owned(),
        ),
        publication_budget: value
            .get("publicationBudget")
            .map(budget)
            .transpose()?
            .unwrap_or_default(),
        logging_retention_days: value
            .get("loggingRetentionDays")
            .map(|value| check::integer(value, 1, check::SAFE_INTEGER / 86_400_000))
            .transpose()?
            .unwrap_or(7),
        trusted_proxy_addresses: value
            .get("trustedProxyAddresses")
            .map(crate::http::public_request_budget::proxies)
            .transpose()?
            .unwrap_or_default(),
    })
}
fn budget(value: &Value) -> Result<Budget> {
    let value = check::object(
        value,
        &[
            "instanceBytes",
            "agentBytes",
            "instanceCount",
            "agentCount",
            "uploads",
        ],
        &[],
    )?;
    let instance_bytes = check::integer(&value["instanceBytes"], 1, 1_099_511_627_776)?;
    let instance_count = check::integer(&value["instanceCount"], 1, 100000)?;
    Ok(Budget {
        instance_bytes,
        instance_count,
        agent_bytes: check::integer(&value["agentBytes"], 1, instance_bytes)?,
        agent_count: check::integer(&value["agentCount"], 1, instance_count)?,
        uploads: check::integer(&value["uploads"], 1, 32)? as usize,
    })
}
pub fn load(directory: &Path) -> Result<Configuration> {
    let directory = PrivateDirectory::open(directory, false)?;
    let bytes = directory.read("config.json", 65536)?;
    let value = serde_json::from_slice(&bytes)
        .map_err(|_| Failure::new(ErrorCode::Invalid, "Invalid private server configuration"))?;
    parse(&value)
}
