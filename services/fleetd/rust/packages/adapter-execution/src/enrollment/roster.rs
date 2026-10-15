use super::*;
use crossfire_domain::coordination::Policy;
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Request<'a> {
    owner_matrix_id: &'a str,
    fleet_key: &'a str,
    controller: Controller<'a>,
    instances: Vec<Entry<'a>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    controller_credential: Option<&'a str>,
}
#[derive(Serialize)]
struct Controller<'a> {
    name: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    metadata: Option<&'a std::collections::BTreeMap<String, String>>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Entry<'a> {
    instance_key: &'a str,
    name: &'a str,
    coordination_policy: PolicyWire<'a>,
    #[serde(skip_serializing_if = "Option::is_none")]
    identity: Option<Proof<'a>>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PolicyWire<'a> {
    wake_mode: &'a str,
    senders: Vec<Sender<'a>>,
    permissions: Vec<&'a str>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Sender<'a> {
    matrix_user_id: &'a str,
    include_agents: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Proof<'a> {
    agent_id: &'a str,
    access_token: &'a str,
}
fn policy(policy: &Policy) -> PolicyWire<'_> {
    PolicyWire {
        wake_mode: policy.mode.code(),
        senders: policy
            .senders
            .iter()
            .map(|sender| Sender {
                matrix_user_id: &sender.matrix_user_id,
                include_agents: sender.include_agents,
            })
            .collect(),
        permissions: if policy.invite_agents {
            vec!["room.agent.invite"]
        } else {
            vec![]
        },
    }
}
fn wire<'a>(
    configuration: &'a Configuration,
    binding: &'a Binding,
    controller: &'a ControllerIdentity,
) -> Result<Request<'a>> {
    let instances = configuration
        .roster
        .instances
        .iter()
        .map(|instance| {
            let definition = configuration
                .definitions
                .get(&instance.definition)
                .ok_or_else(|| {
                    Failure::new(ErrorCode::Invalid, "Enrollment role definition is missing")
                })?;
            let identity = binding
                .identities
                .iter()
                .find(|identity| identity.instance_key == instance.key)
                .map(|identity| Proof {
                    agent_id: &identity.agent_id,
                    access_token: identity.account.access_token.expose(),
                });
            Ok(Entry {
                instance_key: &instance.key,
                name: &instance.name,
                coordination_policy: policy(&definition.coordination_policy),
                identity,
            })
        })
        .collect::<Result<_>>()?;
    Ok(Request {
        owner_matrix_id: &binding.owner,
        fleet_key: &binding.fleet_key,
        controller: Controller {
            name: &controller.name,
            metadata: controller.metadata.as_ref(),
        },
        instances,
        controller_credential: binding.controller_credential.as_ref().map(Secret::expose),
    })
}
pub fn request(
    configuration: &Configuration,
    binding: &Binding,
    controller: &ControllerIdentity,
) -> Result<Value> {
    serde_json::to_value(wire(configuration, binding, controller)?)
        .map_err(|_| Failure::new(ErrorCode::Invalid, "Enrollment roster encoding failed"))
}
pub fn digest(
    configuration: &Configuration,
    binding: &Binding,
    controller: &ControllerIdentity,
) -> Result<String> {
    Ok(identity::hash(
        &serde_json::to_string(&wire(configuration, binding, controller)?)
            .map_err(|_| Failure::new(ErrorCode::Invalid, "Enrollment roster encoding failed"))?,
    ))
}
pub async fn verify(
    configuration: &Configuration,
    binding: &Binding,
    client: &impl Coordination,
    stop: CancellationToken,
) -> Result<()> {
    let fleet = binding
        .fleet_id
        .as_deref()
        .ok_or_else(|| Failure::new(ErrorCode::Conflict, "Fleet has no approved identity"))?;
    let mut call = Call::new(OperationId::Fleet);
    call.parameters
        .insert("fleetId".to_owned(), fleet.to_owned());
    let current = client.call(&call, stop.clone()).await?;
    if current["fleetId"] != fleet
        || current["fleetKey"] != binding.fleet_key
        || current["owner"]["matrixUserId"] != binding.owner
    {
        return Err(Failure::new(
            ErrorCode::Conflict,
            "Approved fleet authority differs from its saved identity",
        ));
    }
    let mut call = Call::new(OperationId::FleetAgents);
    call.parameters
        .insert("fleetId".to_owned(), fleet.to_owned());
    call.query.extend([
        ("page".to_owned(), "1".to_owned()),
        ("pageSize".to_owned(), "100".to_owned()),
    ]);
    let registered = client.call(&call, stop).await?;
    let rows = check::list(
        &registered["items"],
        configuration.roster.instances.len(),
        configuration.roster.instances.len(),
    )?;
    let meta = &registered["meta"];
    if meta["page"] != 1
        || meta["pageSize"] != 100
        || meta["totalPages"] != 1
        || meta["totalItems"] != rows.len()
    {
        return Err(Failure::new(
            ErrorCode::Conflict,
            "Approved fleet roster is incomplete or differs from its configured instances",
        ));
    }
    let mut keys = BTreeSet::new();
    let mut agents = BTreeSet::new();
    for row in rows {
        let key = check::name(&row["instanceKey"])?;
        let agent = &row["agent"];
        let id = check::identifier(&agent["agentId"])?;
        if !keys.insert(key) || !agents.insert(id) {
            return Err(Failure::new(
                ErrorCode::Invalid,
                "Duplicate approved fleet identity",
            ));
        }
        let expected = binding
            .identities
            .iter()
            .find(|identity| identity.instance_key == key)
            .ok_or_else(|| {
                Failure::new(
                    ErrorCode::Conflict,
                    "Approved instance is not in the saved roster",
                )
            })?;
        let configured = configuration
            .roster
            .instances
            .iter()
            .find(|instance| instance.key == key)
            .ok_or_else(|| {
                Failure::new(ErrorCode::Conflict, "Approved instance is not configured")
            })?;
        if id != expected.agent_id
            || agent["name"] != configured.name
            || agent["matrixUserId"] != expected.account.user_id
            || agent["deployment"]["fleetId"] != fleet
            || agent["deployment"]["instanceKey"] != key
            || agent["owner"]["matrixUserId"] != binding.owner
        {
            return Err(Failure::new(
                ErrorCode::Conflict,
                format!("Approved fleet instance differs from its saved identity: {key}"),
            ));
        }
        if agent["status"] != "active" || agent["owner"]["status"] != "active" {
            return Err(Failure::new(
                ErrorCode::Forbidden,
                "Fleet resume requires active existing agent and owner accounts",
            ));
        }
    }
    Ok(())
}
