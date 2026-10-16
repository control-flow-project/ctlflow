use crate::{
    arguments::{self, Arguments, invalid},
    connections::{self, Remote},
    launcher,
    operations::{self, call, output},
};
use crossfire_contracts::validation as check;
use crossfire_kernel::Result;
use fleet_daemon_client::Client;
use fleet_ssh_transport::Tunnel;
use fleetd_contracts::operations::OperationId;
use serde_json::json;
use std::{collections::BTreeMap, path::Path};
use tokio_util::sync::CancellationToken;

pub async fn run(values: Vec<String>, stop: CancellationToken) -> Result<()> {
    let args = arguments::parse(values)?;
    let words = &args.words;
    if args.has("help") || words.is_empty() {
        println!("{}", arguments::USAGE);
        return Ok(());
    }
    if words[0] == "setup" {
        if words.len() != 1 || args.has("remote") {
            return Err(invalid("Setup runs locally on the agent computer"));
        }
        return crate::setup::run(&args, stop).await;
    }
    let mut settings = connections::load()?;
    if words[0] == "remote" {
        if words.len() != 3 || words[1] != "add" || args.has("remote") {
            return Err(invalid(arguments::USAGE));
        }
        let ssh = args
            .get("ssh")
            .ok_or_else(|| invalid("Select --ssh USER@HOST"))?;
        let root = args
            .get("root")
            .ok_or_else(|| invalid("Select an absolute remote controller root"))?;
        check::name(&json!(words[2]))?;
        if !fleet_ssh_transport::valid_host(ssh)
            || !fleet_ssh_transport::valid_root(root)
            || settings
                .remotes
                .iter()
                .any(|remote| remote.name == words[2])
        {
            return Err(invalid("Invalid or duplicated remote identity"));
        }
        settings.remotes.push(Remote {
            name: words[2].clone(),
            ssh: ssh.to_owned(),
            root: root.to_owned(),
        });
        connections::save(&settings)?;
        return output(&json!({"saved":words[2]}));
    }
    if args.has("root") && args.has("remote") {
        return Err(invalid("Select a local root or remote, not both"));
    }
    let remote = args
        .get("remote")
        .map(|name| {
            settings
                .remotes
                .iter()
                .find(|remote| remote.name == name)
                .cloned()
                .ok_or_else(|| invalid("Remote connection not found"))
        })
        .transpose()?;
    let root = match &remote {
        Some(remote) => remote.root.clone().into(),
        None => args
            .get("root")
            .map(connections::absolute)
            .transpose()?
            .or(settings.local_root.clone())
            .ok_or_else(|| invalid("Select --root DIRECTORY or --remote NAME"))?,
    };
    if words[0] == "daemon" && words.get(1).map(String::as_str) == Some("start") {
        if words.len() != 2 || remote.is_some() {
            return Err(invalid("Start the controller locally on its computer"));
        }
        let status = launcher::launch(&root, args.get("name"), stop).await?;
        settings.local_root = Some(root);
        connections::save(&settings)?;
        return output(&status);
    }
    if remote.is_none()
        && (words[0] == "start"
            || words[0] == "agent" && words.get(1).map(String::as_str) == Some("start"))
    {
        launcher::launch(&root, None, stop.clone()).await?;
    }
    let mut tunnel = match &remote {
        Some(remote) => Some(Tunnel::open(&remote.ssh, &remote.root, stop.clone()).await?),
        None => None,
    };
    let socket = tunnel
        .as_ref()
        .map(Tunnel::socket)
        .unwrap_or_else(|| root.join("fleetd.sock"));
    let result = async {
        let client = Client::open(&socket, stop.clone())?;
        invoke(&args, &client, &root, remote.as_ref(), stop).await
    }
    .await;
    if let Some(tunnel) = tunnel.as_mut() {
        tunnel.close().await?
    }
    result
}
async fn invoke(
    args: &Arguments,
    client: &Client,
    root: &Path,
    remote: Option<&Remote>,
    stop: CancellationToken,
) -> Result<()> {
    let words = &args.words;
    let empty = BTreeMap::new();
    if words[0] == "daemon" {
        if words.len() != 2 {
            return Err(invalid(arguments::USAGE));
        }
        let value = match words[1].as_str() {
            "status" => call(client, OperationId::Status, empty, None, stop).await?,
            "stop" => {
                call(
                    client,
                    OperationId::Operate,
                    empty,
                    Some(launcher::stop_request()),
                    stop,
                )
                .await?
            }
            "restart" if remote.is_none() => launcher::restart(root, stop).await?,
            _ => {
                return Err(invalid(
                    "Use daemon status|stop|restart; restart runs on its controller computer",
                ));
            }
        };
        return output(&value);
    }
    if words[0] == "add" {
        if words.len() != 2 {
            return Err(invalid(arguments::USAGE));
        }
        return output(&call(client,OperationId::AddFleet,empty,Some(json!({"directory":if remote.is_none(){connections::absolute(&words[1])?}else{words[1].clone().into()}})),stop).await?);
    }
    let fleets = operations::fleets(client, stop.clone()).await?;
    if words[0] == "list" && words.len() == 1 {
        return output(&json!(fleets));
    }
    let agent = words[0] == "agent";
    let command = words
        .get(usize::from(agent))
        .ok_or_else(|| invalid(arguments::USAGE))?;
    let key = words
        .get(if agent { 2 } else { 1 })
        .ok_or_else(|| invalid(arguments::USAGE))?;
    let fleet = fleets
        .iter()
        .find(|fleet| {
            fleet["fleetKey"].as_str() == Some(key) || fleet["fleetId"].as_str() == Some(key)
        })
        .ok_or_else(|| invalid(format!("Fleet not found: {key}")))?;
    let fleet_id = check::identifier(&fleet["fleetId"])?.to_owned();
    let revision = check::integer(&fleet["revision"], 0, check::SAFE_INTEGER)?;
    let parameters = BTreeMap::from([("fleetId".to_owned(), fleet_id.clone())]);
    if !agent && words.len() == 2 {
        match command.as_str(){
            "show"=>return output(fleet),
            "test"=>return output(&call(client,OperationId::Readiness,parameters,None,stop).await?),
            "remove"=>return output(&call(client,OperationId::RemoveFleet,parameters,Some(json!({"expectedRevision":revision})),stop).await?),
            "activate"|"deactivate"=>return output(&call(client,OperationId::ChangeFleetDelivery,parameters,Some(json!({"expectedRevision":fleet["connection"]["revision"],"enabled":command=="activate"})),stop).await?),
            "message"=>{let message=operations::identifier(args.get("message-id"))?;output(&json!({"messageId":message}))?;return output(&call(client,OperationId::CreateFleetMessage,parameters,Some(json!({"messageId":message,"body":args.get("text").ok_or_else(||invalid("Select --text TEXT"))?})),stop).await?)},
            _=>{},
        }
    }
    if agent && command == "list" && words.len() == 3 {
        return output(&fleet["instances"]);
    }
    if words.len() != if agent { 4 } else { 2 } {
        return Err(invalid(arguments::USAGE));
    }
    let instance = if agent {
        Some(check::name(&json!(words[3]))?.to_owned())
    } else {
        None
    };
    let mut agent_parameters = parameters.clone();
    if let Some(instance) = &instance {
        agent_parameters.insert("instanceKey".to_owned(), instance.clone());
    }
    if agent {
        match command.as_str() {
            "add" => {
                let definition = args
                    .get("definition")
                    .ok_or_else(|| invalid("Select --definition NAME"))?;
                check::name(&json!(definition))?;
                return output(&call(client,OperationId::AddAgent,parameters,Some(json!({"expectedRevision":revision,"instance":{"key":instance,"name":instance,"definition":definition,"workarea":format!("agents/{definition}/workarea/{}",words[3])}})),stop).await?);
            }
            "remove" => {
                return output(
                    &call(
                        client,
                        OperationId::RemoveAgent,
                        agent_parameters,
                        Some(json!({"expectedRevision":revision})),
                        stop,
                    )
                    .await?,
                );
            }
            "contexts" => {
                return output(
                    &call(client, OperationId::Contexts, agent_parameters, None, stop).await?,
                );
            }
            "attach" => {
                return operations::attach(
                    client,
                    agent_parameters,
                    args.get("context"),
                    remote.map(|remote| remote.ssh.as_str()),
                    stop,
                )
                .await;
            }
            _ => {}
        }
    }
    if !["enroll", "start", "stop", "update"].contains(&command.as_str())
        || agent && command == "enroll"
    {
        return Err(invalid(arguments::USAGE));
    }
    if command == "update" && remote.is_some() && !args.has("release-directory") {
        return Err(invalid(
            "Remote update requires an explicit remote release directory",
        ));
    }
    let operation = operations::identifier(args.get("operation-id"))?;
    let mut target = json!({"kind":if agent{"agent"}else{"fleet"},"fleetId":fleet_id});
    if let Some(instance) = instance {
        target["instanceKey"] = json!(instance);
    }
    let mut request = json!({"operationId":operation,"target":target,"action":if args.has("fresh-history"){"reset"}else{command},"expectedRevision":revision});
    if command == "update" {
        request["releaseDirectory"] = json!(match args.get("release-directory") {
            Some(path) => connections::absolute(path)?,
            None => launcher::release_directory()?,
        });
    }
    output(&json!({"operationId":operation}))?;
    let accepted = call(
        client,
        OperationId::Operate,
        BTreeMap::new(),
        Some(request),
        stop.clone(),
    )
    .await?;
    output(&operations::observe(client, accepted, stop).await?)
}
