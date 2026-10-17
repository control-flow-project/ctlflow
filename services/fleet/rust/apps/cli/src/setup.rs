use crate::{
    arguments::{Arguments, invalid},
    connections::{self, Project},
    launcher,
    operations::{self, call, output},
};
use crossfire_adapter_filesystem::owned::{DirectoryAccess, OwnedFile, validate_directory};
use crossfire_adapter_http::{JsonLimits, NativeHttp};
use crossfire_contracts::{origin, validation as check};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use fleet_daemon_client::Client;
use fleetd_contracts::{configuration, operations::OperationId, setup};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    time::Duration,
};
use tokio_util::sync::CancellationToken;

pub fn descriptor_url(address: &str) -> Result<(String, String, String)> {
    let uri = url::Url::parse(address)
        .map_err(|_| invalid("Use the personalized Crossfire setup descriptor URL"))?;
    let server = uri.origin().ascii_serialization();
    origin::parse(&server)?;
    if uri.path() != "/onboarding/setup.json"
        || !uri.username().is_empty()
        || uri.password().is_some()
        || uri.fragment().is_some()
    {
        return Err(invalid(
            "Use the personalized Crossfire setup descriptor URL",
        ));
    }
    let query = uri.query_pairs().collect::<Vec<_>>();
    if query.len() != 1 || query[0].0 != "ownerMatrixId" {
        return Err(invalid("Descriptor requires exactly one ownerMatrixId"));
    }
    let owner = check::matrix_user_id(&json!(query[0].1))?.to_owned();
    Ok((
        server,
        owner,
        format!("{}?{}", uri.path(), uri.query().unwrap_or("")),
    ))
}
fn configured_descriptor(file: &Path) -> Result<String> {
    if !file.is_absolute()
        || connections::absolute(connections::text(file)?)? != file
        || file.file_name().is_none_or(|file| file != "runtime.toml")
    {
        return Err(invalid(
            "Use an exact absolute non-symlink runtime.toml configuration",
        ));
    }
    let bytes = OwnedFile::open(file, 1048576)?
        .ok_or_else(|| invalid("Fleet configuration is missing"))?
        .configuration(1048576)?;
    let table = crossfire_adapter_toml::parse(&bytes)?;
    let value =
        serde_json::to_value(table).map_err(|_| invalid("Cannot decode fleet configuration"))?;
    let roster = configuration::roster(&value)?;
    Ok(format!(
        "{}/onboarding/setup.json?ownerMatrixId={}",
        roster.coordination.server,
        origin::segment(&roster.coordination.owner)
    ))
}
async fn descriptor(address: &str, stop: CancellationToken) -> Result<Value> {
    let (server, owner, path) = descriptor_url(address)?;
    let response = NativeHttp::new(&server, stop)?
        .json(
            None,
            reqwest::Method::GET,
            &path,
            None,
            JsonLimits {
                request_bytes: 0,
                response_bytes: 262144,
                timeout: Duration::from_secs(30),
            },
        )
        .await?;
    if response.status != 200 {
        return Err(Failure::new(
            ErrorCode::Unavailable,
            "Cannot fetch the trusted setup descriptor",
        ));
    }
    let parsed = setup::descriptor(&response.body)?;
    if parsed.server != server || parsed.owner != owner {
        return Err(invalid(
            "Descriptor differs from its requested server and owner",
        ));
    }
    Ok(response.body)
}
fn ready(fleet: &Value) -> bool {
    fleet["connection"]["connected"] == true
        && fleet["instances"].as_array().is_some_and(|instances| {
            instances.iter().all(|instance| {
                instance["desiredActive"] == false
                    || instance["sessionId"].is_string()
                        && matches!(instance["phase"].as_str(), Some("running" | "sleeping"))
            })
        })
}
pub async fn run(args: &Arguments, stop: CancellationToken) -> Result<()> {
    let workspace =
        std::env::current_dir().map_err(|_| invalid("Working directory unavailable"))?;
    validate_directory(&workspace, DirectoryAccess::Configuration)?;
    let previous = connections::project(&workspace)?;
    let configuration = args.get("config").map(PathBuf::from).or_else(|| {
        previous
            .as_ref()
            .and_then(|previous| previous.configuration.clone())
    });
    let address=match args.get("descriptor"){Some(value)=>value.to_owned(),None=>match &configuration{Some(file)=>configured_descriptor(file)?,None=>previous.as_ref().map(|value|value.descriptor.clone()).ok_or_else(||invalid("Use fleet setup --descriptor PERSONALIZED_SETUP_URL or --config /absolute/runtime.toml"))?}};
    let mut settings = connections::load()?;
    let root = args
        .get("root")
        .map(connections::absolute)
        .transpose()?
        .or_else(|| previous.as_ref().map(|value| value.root.clone()))
        .or(settings.local_root.clone())
        .unwrap_or(connections::home()?.join(".ctlflow/controller"));
    if workspace == root || workspace.starts_with(&root) {
        return Err(invalid(
            "Controller state must be separate from and not contain the current project",
        ));
    }
    let project = Project {
        workspace: workspace.clone(),
        descriptor: address.clone(),
        root: root.clone(),
        configuration,
    };
    if previous
        .as_ref()
        .is_some_and(|previous| previous != &project)
    {
        return Err(invalid(
            "Project already has different saved setup authority; use its original configuration",
        ));
    }
    let descriptor = descriptor(&address, stop.clone()).await?;
    connections::save_project(&project)?;
    output(
        &json!({"status":"starting-controller","workspace":workspace,"controllerRoot":root,"server":descriptor["server"],"owner":descriptor["ownerMatrixId"],"conversation":"New fleet-managed agent; this coding session remains independent"}),
    )?;
    let controller = launcher::launch(&root, None, stop.clone()).await?;
    settings.local_root = Some(root.clone());
    connections::save(&settings)?;
    let client = Client::open(&root.join("fleetd.sock"), stop.clone())?;
    let mut input = json!({"descriptor":descriptor,"workspace":workspace});
    if let Some(configuration) = project.configuration {
        input["configuration"] = json!(configuration);
    }
    let prepared = call(
        &client,
        OperationId::Setup,
        BTreeMap::new(),
        Some(input),
        stop.clone(),
    )
    .await?;
    let fleet_id = check::identifier(&prepared["fleet"]["fleetId"])?.to_owned();
    let parameters = BTreeMap::from([("fleetId".to_owned(), fleet_id)]);
    if prepared["operation"].is_object() {
        output(
            &json!({"operationId":prepared["operation"]["operationId"],"fleet":prepared["fleet"]["fleetKey"]}),
        )?;
        operations::observe(&client, prepared["operation"].clone(), stop.clone()).await?;
    }
    let stopped = prepared["status"] == "stopped";
    let mut current = call(
        &client,
        OperationId::Fleet,
        parameters.clone(),
        None,
        stop.clone(),
    )
    .await?;
    if !stopped {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(65);
        while !ready(&current) {
            if !current["error"].is_null()
                || current["instances"].as_array().is_some_and(|instances| {
                    instances.iter().any(|instance| {
                        instance["desiredActive"] == true && instance["phase"] == "failed"
                    })
                })
            {
                return Err(Failure::new(
                    ErrorCode::Unavailable,
                    "Setup did not reach a ready binding; inspect fleet show. No model housekeeping was sent.",
                ));
            }
            launcher::wait(stop.clone(), deadline, Duration::from_millis(100)).await?;
            current = call(
                &client,
                OperationId::Fleet,
                parameters.clone(),
                None,
                stop.clone(),
            )
            .await?;
        }
        call(&client, OperationId::Readiness, parameters, None, stop).await?;
    }
    output(
        &json!({"status":if stopped{"stopped"}else{"ready"},"controller":controller["controller"]["name"],"fleet":current["fleetKey"],"agentCount":current["instances"].as_array().map_or(0,Vec::len),"histories":"retained","message":if stopped{"Existing stop intent is preserved. Run fleet start when ready."}else{"Controller and bindings are ready; no rooms or model housekeeping were created."}}),
    )
}
