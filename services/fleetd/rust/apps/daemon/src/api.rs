use crate::host::ControllerOwner;
use crossfire_adapter_filesystem::logging::Store;
use crossfire_adapter_http::{
    routing::{self, Selection},
    server::{self, Body, Incoming, Peer, Request, Response},
};
use crossfire_contracts::{call::Key, envelope, query, validation as check};
use crossfire_kernel::{Failure, Result, failure::ErrorCode, identity};
use fleetd_contracts::{
    configuration, operation,
    operations::{self, OperationId},
    setup, wire,
};
use fleetd_domain::controller::registry::Edit;
use serde_json::{Value, json};
use std::{collections::BTreeMap, path::Path, sync::Arc};
use tokio_util::sync::CancellationToken;

pub struct State {
    pub authentication_key: crossfire_kernel::secret::Secret,
    pub controller: Arc<ControllerOwner>,
    pub diagnostics: Arc<Store>,
    pub days: i64,
    pub stop: CancellationToken,
}
struct Reply {
    data: Value,
    meta: envelope::Metadata,
}
fn invalid(message: &str) -> Failure {
    Failure::new(ErrorCode::Invalid, message)
}
fn revision(input: &Value) -> Result<i64> {
    check::integer(&input["expectedRevision"], 0, check::SAFE_INTEGER)
}
fn field<'a>(input: &'a Value, name: &str) -> Result<&'a str> {
    check::text(&input[name], 1, 4096)
}
fn fields(input: &Value, fields: &[&str]) -> Result<()> {
    check::object(input, fields, &[]).map(|_| ())
}
fn page(items: Vec<Value>, query: &BTreeMap<&str, &str>, id: String) -> Result<Reply> {
    let (page, size) = query::pagination(query)?;
    let total = items.len() as i64;
    Ok(Reply {
        data: Value::Array(
            items
                .into_iter()
                .skip(((page - 1) * size) as usize)
                .take(size as usize)
                .collect(),
        ),
        meta: envelope::Metadata {
            request_id: id,
            page: Some(page),
            page_size: Some(size),
            total_items: Some(total),
            total_pages: Some(((total + size - 1) / size).max(1)),
        },
    })
}
pub async fn handle(
    state: Arc<State>,
    request: Request<Incoming>,
    peer: Peer,
) -> Result<Response<Body>> {
    let id = identity::id();
    let mut status = 200;
    let result = async {
        if !matches!(peer,Peer::Unix(uid)if uid==rustix::process::getuid().as_raw())
            || request
                .headers()
                .get(server::header::HOST)
                .and_then(|header| header.to_str().ok())
                != Some("localhost")
            || [server::header::ORIGIN, server::header::COOKIE]
                .iter()
                .any(|header| request.headers().contains_key(header))
        {
            return Err(Failure::new(
                ErrorCode::Forbidden,
                "Use the private controller socket without browser credentials",
            ));
        }
        if request
            .headers()
            .get_all(server::header::AUTHORIZATION)
            .iter()
            .count()
            != 1
            || !fleetd_storage::authentication::matches(
                request
                    .headers()
                    .get(server::header::AUTHORIZATION)
                    .and_then(|header| header.to_str().ok()),
                &state.authentication_key,
            )
        {
            return Err(Failure::new(
                ErrorCode::Unauthorized,
                "Valid fleetd authentication is required",
            ));
        }
        let path = routing::path(&request)?;
        let selected = routing::select(operations::OPERATIONS, request.method(), path)?;
        selected.validate()?;
        status = selected.operation.status;
        let pairs = url::form_urlencoded::parse(request.uri().query().unwrap_or("").as_bytes())
            .into_owned()
            .collect::<Vec<_>>();
        let query = query::parameters(&pairs, selected.operation.id.query_fields())?;
        let content = request
            .headers()
            .get(server::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned);
        let body = server::read(request.into_body(), 1048576).await?;
        if !body.is_empty()
            && content.as_deref().and_then(|value| value.split(';').next())
                != Some("application/json")
        {
            return Err(invalid("Use application/json"));
        }
        let input = if body.is_empty() {
            json!({})
        } else {
            serde_json::from_slice(&body).map_err(|_| invalid("Invalid JSON request"))?
        };
        invoke(&state, &selected, &query, &input, id.clone()).await
    }
    .await;
    let value = match result {
        Ok(reply) => json!({"data":reply.data,"meta":reply.meta}),
        Err(error) => {
            status = envelope::http_status(error.code);
            json!({"error":error,"meta":envelope::metadata(id)})
        }
    };
    let mut bytes = crossfire_kernel::bytes::Buffer::new(16777216);
    serde_json::to_writer(&mut bytes, &value)
        .map_err(|_| invalid("Daemon response exceeds its finite output bound"))?;
    let mut response = Response::new(server::full(bytes.into_vec()));
    *response.status_mut() =
        server::StatusCode::from_u16(status).map_err(|_| invalid("Invalid response status"))?;
    response.headers_mut().insert(
        server::header::CONTENT_TYPE,
        server::header::HeaderValue::from_static("application/json; charset=utf-8"),
    );
    response.headers_mut().insert(
        server::header::CACHE_CONTROL,
        server::header::HeaderValue::from_static("no-store"),
    );
    response.headers_mut().insert(
        server::header::X_CONTENT_TYPE_OPTIONS,
        server::header::HeaderValue::from_static("nosniff"),
    );
    if state.controller.stopping()? {
        state.stop.cancel();
    }
    Ok(response)
}
async fn invoke(
    state: &State,
    selected: &Selection<OperationId>,
    query: &BTreeMap<&str, &str>,
    input: &Value,
    id: String,
) -> Result<Reply> {
    let controller = &state.controller;
    let stop = state.stop.child_token();
    let fleet = selected
        .parameters
        .get("fleetId")
        .map(String::as_str)
        .unwrap_or("");
    let instance = selected
        .parameters
        .get("instanceKey")
        .map(String::as_str)
        .unwrap_or("");
    let data = match selected.operation.id {
        OperationId::Diagnostics => {
            fields(input, &[])?;
            let mut report = controller
                .diagnostics(fleetd_contracts::diagnostics::query(query)?, stop)
                .await?;
            let failed = state.diagnostics.error()?.is_some();
            report.add(
                "controller.logging",
                &fleetd_domain::diagnostics::Scope {
                    fleet_id: None,
                    instance_key: None,
                },
                if failed { "fail" } else { "pass" },
                Some(report.checked_at),
                if failed {
                    "Controller logging has failed"
                } else {
                    "Controller logging is available"
                },
                failed.then_some("Check disk space and controller log permissions"),
            );
            fleetd_contracts::diagnostics::value(&report)
        }
        OperationId::Status => {
            fields(input, &[])?;
            json!({"controller":wire::controller(&controller.identity),"startedAt":controller.started_at,"stopping":controller.stopping()?,"loggingRetentionDays":state.days,"loggingError":state.diagnostics.error()?})
        }
        OperationId::Setup => {
            let outcome = controller.setup(&setup::request(input)?, stop).await?;
            json!({"fleet":wire::state(&outcome.fleet),"operation":outcome.operation.as_ref().map(operation::value),"status":outcome.status})
        }
        OperationId::Fleets => {
            fields(input, &[])?;
            return page(
                controller.list()?.iter().map(wire::state).collect(),
                query,
                id,
            );
        }
        OperationId::AddFleet => {
            fields(input, &["directory"])?;
            wire::state(&controller.add(Path::new(field(input, "directory")?))?)
        }
        OperationId::Fleet => {
            fields(input, &[])?;
            wire::state(&controller.view(fleet)?)
        }
        OperationId::Readiness => {
            fields(input, &[])?;
            controller.test(fleet, stop).await?;
            json!({"accepted":true})
        }
        OperationId::ChangeFleet => {
            fields(input, &["expectedRevision", "label"])?;
            wire::state(&controller.rename(fleet, revision(input)?, field(input, "label")?)?)
        }
        OperationId::RemoveFleet => {
            fields(input, &["expectedRevision"])?;
            controller.remove(fleet, revision(input)?, stop).await?;
            json!({"accepted":true})
        }
        OperationId::ChangeFleetDelivery => {
            fields(input, &["expectedRevision", "enabled"])?;
            controller
                .delivery(
                    fleet,
                    revision(input)?,
                    check::boolean(&input["enabled"])?,
                    stop,
                )
                .await?
        }
        OperationId::CreateFleetMessage => {
            fields(input, &["messageId", "body"])?;
            let message = check::identifier(&input["messageId"])?;
            let body = check::plain_text(&input["body"], 4096)?;
            if body.trim().is_empty() {
                return Err(invalid("Fleet message cannot be empty"));
            }
            controller.message(fleet, message, body, stop).await?
        }
        OperationId::Agents => {
            fields(input, &[])?;
            return page(
                controller
                    .view(fleet)?
                    .instances
                    .iter()
                    .map(wire::instance_state)
                    .collect(),
                query,
                id,
            );
        }
        OperationId::Agent => {
            fields(input, &[])?;
            wire::instance_state(
                controller
                    .view(fleet)?
                    .instances
                    .iter()
                    .find(|value| value.instance.key == instance)
                    .ok_or_else(|| Failure::new(ErrorCode::Missing, "Instance not found"))?,
            )
        }
        OperationId::Contexts => {
            fields(input, &[])?;
            Value::Array(controller.contexts(fleet,instance).await?.iter().map(|value|json!({"context":value.context,"runtime":value.runtime,"sessionId":value.session_id})).collect())
        }
        OperationId::Attachment => {
            fields(input, &[])?;
            let value = controller
                .attachment(fleet, instance, query.get("context").copied())
                .await?;
            json!({"runtime":value.runtime,"sessionId":value.session_id,"workspace":value.workspace,"connection":value.connection})
        }
        OperationId::AddAgent => {
            fields(input, &["expectedRevision", "instance"])?;
            wire::state(
                &controller
                    .edit(
                        fleet,
                        revision(input)?,
                        Edit::Add(configuration::api_instance(&input["instance"])?),
                        stop,
                    )
                    .await?,
            )
        }
        OperationId::ChangeAgent => {
            fields(input, &["expectedRevision", "definition"])?;
            wire::state(
                &controller
                    .edit(
                        fleet,
                        revision(input)?,
                        Edit::Definition {
                            instance: instance.to_owned(),
                            definition: check::name(&input["definition"])?.to_owned(),
                        },
                        stop,
                    )
                    .await?,
            )
        }
        OperationId::RemoveAgent => {
            fields(input, &["expectedRevision"])?;
            wire::state(
                &controller
                    .edit(
                        fleet,
                        revision(input)?,
                        Edit::Remove(instance.to_owned()),
                        stop,
                    )
                    .await?,
            )
        }
        OperationId::Operate => operation::value(
            &controller
                .operate(operation::request(input, false)?, false)
                .await?,
        ),
        OperationId::Operation => {
            fields(input, &[])?;
            operation::value(&controller.operation(selected.parameter("operationId")?)?)
        }
    };
    Ok(Reply {
        data,
        meta: envelope::metadata(id),
    })
}
