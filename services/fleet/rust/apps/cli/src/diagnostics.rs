use crate::{
    arguments::{self, invalid},
    connections::Remote,
    operations,
};
use crossfire_contracts::{call::Call, validation as check};
use crossfire_kernel::{Failure, Result, failure::ErrorCode, identity};
use fleet_daemon_client::Client;
use fleet_ssh_transport::Tunnel;
use fleetd_contracts::operations::OperationId;
use serde_json::{Value, json};
use std::{path::Path, time::Duration};
use tokio_util::sync::CancellationToken;

pub async fn run(
    root: &Path,
    remote: Option<&Remote>,
    words: &[String],
    stop: CancellationToken,
) -> Result<()> {
    let agent = words[0] == "agent";
    if if agent {
        words.len() != 4
    } else {
        words.len() > 2
    } {
        return Err(invalid(arguments::USAGE));
    }
    let key = words.get(if agent { 2 } else { 1 });
    if let Some(key) = key
        && check::name(&json!(key)).is_err()
        && check::identifier(&json!(key)).is_err()
    {
        return Err(invalid("Use a configured fleet key or UUID"));
    }
    let instance = if agent {
        Some(check::name(&json!(words[3]))?.to_owned())
    } else {
        None
    };
    let checked_at = identity::now()?;
    let deadline = tokio::time::Instant::now() + Duration::from_secs(30);
    let cancellation = stop.child_token();
    let mut tunnel = match remote {
        Some(remote) => match tokio::time::timeout_at(
            deadline,
            Tunnel::open(&remote.ssh, &remote.root, cancellation.clone()),
        )
        .await
        {
            Ok(Ok(tunnel)) => Some(tunnel),
            _ => {
                cancellation.cancel();
                return finish(unavailable(checked_at, false));
            }
        },
        None => None,
    };
    let result = async {
        let socket = tunnel
            .as_ref()
            .map(Tunnel::socket)
            .unwrap_or_else(|| root.join("fleetd.sock"));
        let client = match tunnel.as_ref().map_or_else(
            || Client::open(&socket, cancellation.clone()),
            |tunnel| {
                Client::authenticated(&socket, cancellation.clone(), tunnel.authentication_key())
            },
        ) {
            Ok(client) => client,
            Err(error) => {
                return Ok(unavailable(
                    checked_at,
                    matches!(error.code, ErrorCode::Unauthorized | ErrorCode::Forbidden),
                ));
            }
        };
        let controller = match client
            .call(&Call::new(OperationId::Diagnostics), cancellation.clone())
            .await
        {
            Ok(report) => report,
            Err(error) => {
                return Ok(unavailable(
                    checked_at,
                    matches!(error.code, ErrorCode::Unauthorized | ErrorCode::Forbidden),
                ));
            }
        };
        let Some(key) = key else {
            return Ok(controller);
        };
        let fleets = match operations::fleets(&client, cancellation.clone()).await {
            Ok(fleets) => fleets,
            Err(_) => return Ok(unavailable(checked_at, false)),
        };
        let fleet = fleets
            .iter()
            .find(|fleet| {
                fleet["fleetKey"].as_str() == Some(key) || fleet["fleetId"].as_str() == Some(key)
            })
            .ok_or_else(|| invalid(format!("Fleet not found: {key}")))?;
        let mut request = Call::new(OperationId::Diagnostics);
        request.query.insert(
            "fleetId".to_owned(),
            check::identifier(&fleet["fleetId"])?.to_owned(),
        );
        if let Some(instance) = instance {
            request.query.insert("instanceKey".to_owned(), instance);
        }
        match client.call(&request, cancellation.clone()).await {
            Ok(report) => Ok(report),
            Err(error)
                if matches!(
                    error.code,
                    ErrorCode::Unavailable | ErrorCode::Unauthorized | ErrorCode::Forbidden
                ) =>
            {
                Ok(unavailable(
                    checked_at,
                    error.code != ErrorCode::Unavailable,
                ))
            }
            Err(error) => Err(error),
        }
    };
    let report = tokio::time::timeout_at(deadline, result)
        .await
        .unwrap_or_else(|_| Ok(unavailable(checked_at, false)));
    cancellation.cancel();
    if let Some(tunnel) = &mut tunnel {
        tunnel.close().await?;
    }
    finish(report?)
}
fn finish(report: Value) -> Result<()> {
    operations::output(&report)?;
    if check::list(&report["checks"], 0, 1000)?
        .iter()
        .any(|check| check["status"] == "fail")
    {
        return Err(Failure::new(
            ErrorCode::Unavailable,
            "Diagnostics found failed checks",
        ));
    }
    Ok(())
}
fn unavailable(checked_at: i64, authentication: bool) -> Value {
    let scope = json!({"fleetId":null,"instanceKey":null});
    json!({"checkedAt":checked_at,"scope":scope,"checks":[
        {"id":"controller.connection","scope":scope,"status":if authentication {"unknown"}else{"fail"},"observedAt":checked_at,"message":if authentication {"Controller diagnostics require the mandatory authentication key"}else{"Selected controller API is unreachable; its cause and native process state are unknown"},"remediation":if authentication {"Check the shared private fleetd authentication configuration; diagnostics never creates or replaces it"}else{"Check the selected computer, controller process and socket; start fleetd explicitly if stopped"}},
        {"id":"controller.authentication","scope":scope,"status":if authentication {"fail"}else{"unknown"},"observedAt":if authentication {Some(checked_at)}else{None},"message":if authentication {"Authentication could not be read or was refused"}else{"Controller authentication could not be verified"},"remediation":null},
        {"id":"fleet.state","scope":scope,"status":"unknown","observedAt":null,"message":"Fleet and native state cannot be inspected without the authenticated controller","remediation":null}
    ]})
}
