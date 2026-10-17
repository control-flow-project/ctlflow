use crate::{arguments::invalid, launcher};
use crossfire_adapter_codex::terminal::CodexTerminal;
use crossfire_agent_core::owned_runtime::{Attachment, Terminal};
use crossfire_contracts::{call::Call, validation as check};
use crossfire_kernel::{Failure, Result, failure::ErrorCode, identity};
use fleet_daemon_client::Client;
use fleetd_contracts::operations::OperationId;
use serde_json::{Value, json};
use std::{collections::BTreeMap, io::Write, time::Duration};
use tokio_util::sync::CancellationToken;

pub fn output(value: &Value) -> Result<()> {
    let bytes =
        serde_json::to_vec_pretty(value).map_err(|_| invalid("Cannot format CLI response"))?;
    let mut stdout = std::io::stdout().lock();
    stdout
        .write_all(&bytes)
        .and_then(|_| stdout.write_all(b"\n"))
        .and_then(|_| stdout.flush())
        .map_err(|_| invalid("Cannot write CLI output"))
}
pub async fn call(
    client: &Client,
    id: OperationId,
    parameters: BTreeMap<String, String>,
    body: Option<Value>,
    stop: CancellationToken,
) -> Result<Value> {
    let mut call = Call::new(id);
    call.parameters = parameters;
    call.body = body;
    client.call(&call, stop).await
}
pub fn identifier(value: Option<&str>) -> Result<String> {
    match value {
        Some(value) => check::identifier(&json!(value)).map(str::to_owned),
        None => Ok(identity::id()),
    }
}
pub async fn observe(client: &Client, mut value: Value, stop: CancellationToken) -> Result<Value> {
    let mut notified = String::new();
    loop {
        if value["approval"].is_object() && value["approval"]["code"].as_str() != Some(&notified) {
            notified = check::text(&value["approval"]["code"], 12, 12)?.to_owned();
            output(
                &json!({"status":"awaiting-approval","code":notified,"url":value["approval"]["url"]}),
            )?;
        }
        match value["status"].as_str() {
            Some("succeeded") => return Ok(value),
            Some("failed") => {
                output(&value)?;
                return Err(Failure::new(
                    ErrorCode::Unavailable,
                    "Operation failed; successful peers and retained histories remain intact. Inspect fleet show and retry explicitly.",
                ));
            }
            Some("accepted" | "running" | "awaiting-approval") => {}
            _ => return Err(invalid("Invalid daemon operation status")),
        }
        let id = check::identifier(&value["operationId"])?.to_owned();
        launcher::wait(
            stop.clone(),
            tokio::time::Instant::now() + Duration::from_secs(3600),
            Duration::from_millis(250),
        )
        .await?;
        value = call(
            client,
            OperationId::Operation,
            BTreeMap::from([("operationId".to_owned(), id)]),
            None,
            stop.clone(),
        )
        .await?;
    }
}
pub async fn fleets(client: &Client, stop: CancellationToken) -> Result<Vec<Value>> {
    let mut all = vec![];
    for page in 1..=100000 {
        let mut call = Call::new(OperationId::Fleets);
        call.query = BTreeMap::from([
            ("page".to_owned(), page.to_string()),
            ("pageSize".to_owned(), "100".to_owned()),
        ]);
        let value = client.call(&call, stop.clone()).await?;
        let items = check::list(&value["items"], 0, 100)?;
        all.extend_from_slice(items);
        if i64::from(page) >= check::integer(&value["meta"]["totalPages"], 1, 100000)? {
            return Ok(all);
        }
    }
    Err(invalid("Fleet pagination exceeded its bound"))
}
pub async fn attach(
    client: &Client,
    parameters: BTreeMap<String, String>,
    context: Option<&str>,
    remote: Option<&str>,
    stop: CancellationToken,
) -> Result<()> {
    let mut call = Call::new(OperationId::Attachment);
    call.parameters = parameters;
    if let Some(context) = context {
        call.query.insert("context".to_owned(), context.to_owned());
    }
    let value = client.call(&call, stop).await?;
    let fields = value["connection"]
        .as_object()
        .ok_or_else(|| invalid("Invalid native terminal connection"))?;
    let connection = fields
        .iter()
        .map(|(key, value)| Ok((key.clone(), check::text(value, 1, 65536)?.to_owned())))
        .collect::<Result<_>>()?;
    let attachment = Attachment {
        runtime: check::text(&value["runtime"], 1, 100)?.to_owned(),
        session_id: check::identifier(&value["sessionId"])?.to_owned(),
        workspace: check::text(&value["workspace"], 1, 4096)?.into(),
        connection,
    };
    let command = CodexTerminal.command(&attachment)?;
    println!(
        "{}",
        match remote {
            Some(host) => fleet_ssh_transport::terminal(host, &command)?,
            None => command,
        }
    );
    Ok(())
}
