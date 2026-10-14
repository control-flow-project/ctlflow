use crate::validation as check;
use crossfire_domain::{
    coordination::Policy,
    enrollment::{
        port::RosterDigest,
        values::{
            Decision, DecisionResult, Entry, Exchange, IdentityProof, Introduction, Receipt,
            Request, Roster,
        },
    },
    identity::WakeMode,
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode, identity};
use icu_collator::{Collator, CollatorBorrowed, options::CollatorOptions};
use serde::Serialize;
use serde_json::{Value, json};
use std::collections::BTreeMap;

pub fn policy(value: &Value) -> Result<Policy> {
    let fields = check::object(value, &["wakeMode", "senders", "permissions"], &[])?;
    let mode = match check::choice(&fields["wakeMode"], &["humans", "everyone", "selected"])? {
        "humans" => WakeMode::Humans,
        "everyone" => WakeMode::Everyone,
        _ => WakeMode::Selected,
    };
    let senders = check::list(&fields["senders"], 0, 2000)?
        .iter()
        .map(|value| {
            let value = check::object(value, &["matrixUserId", "includeAgents"], &[])?;
            Ok(crossfire_domain::coordination::MatrixSender {
                matrix_user_id: check::matrix_user_id(&value["matrixUserId"])?.to_owned(),
                include_agents: check::boolean(&value["includeAgents"])?,
            })
        })
        .collect::<Result<Vec<_>>>()?;
    let permissions = check::list(&fields["permissions"], 0, 1)?;
    for value in permissions {
        check::choice(value, &["room.agent.invite"])?;
    }
    if mode == WakeMode::Everyone && !senders.is_empty()
        || senders
            .iter()
            .map(|sender| &sender.matrix_user_id)
            .collect::<std::collections::BTreeSet<_>>()
            .len()
            != senders.len()
    {
        return Err(Failure::new(
            ErrorCode::Invalid,
            "Select unique identities; everyone requires no individual selections",
        ));
    }
    Ok(Policy {
        mode,
        senders,
        invite_agents: !permissions.is_empty(),
    })
}
fn controller(value: &Value) -> Result<crossfire_domain::enrollment::values::Controller> {
    let value = check::object(value, &["name"], &["metadata"])?;
    let name = check::text(&value["name"], 1, 100)?.to_owned();
    let mut metadata = BTreeMap::new();
    if let Some(value) = value.get("metadata") {
        let values = value
            .as_object()
            .filter(|values| values.len() <= 16)
            .ok_or_else(|| {
                Failure::new(
                    ErrorCode::Invalid,
                    "Controller metadata supports at most 16 text fields",
                )
            })?;
        for (key, value) in values {
            check::name(&json!(key))?;
            metadata.insert(key.clone(), check::text(value, 0, 256)?.to_owned());
        }
    }
    Ok(crossfire_domain::enrollment::values::Controller { name, metadata })
}
fn decode_roster(value: &serde_json::Map<String, Value>) -> Result<Roster> {
    let instances = check::list(&value["instances"], 1, 100)?
        .iter()
        .map(|value| {
            let value = check::object(
                value,
                &["instanceKey", "name", "coordinationPolicy"],
                &["identity"],
            )?;
            let identity = value
                .get("identity")
                .map(|value| {
                    let value = check::object(value, &["agentId", "accessToken"], &[])?;
                    Ok(IdentityProof {
                        agent_id: check::identifier(&value["agentId"])?.to_owned(),
                        access_token: crossfire_kernel::secret::Secret::new(
                            check::text(&value["accessToken"], 1, 8192)?.to_owned(),
                        ),
                    })
                })
                .transpose()?;
            Ok(Entry {
                instance_key: check::name(&value["instanceKey"])?.to_owned(),
                name: check::name(&value["name"])?.to_owned(),
                identity,
                policy: policy(&value["coordinationPolicy"])?,
            })
        })
        .collect::<Result<Vec<_>>>()?;
    Ok(Roster {
        controller: controller(&value["controller"])?,
        owner_matrix_id: check::matrix_user_id(&value["ownerMatrixId"])?.to_owned(),
        fleet_key: check::name(&value["fleetKey"])?.to_owned(),
        instances,
        controller_credential: value
            .get("controllerCredential")
            .map(|value| {
                check::text(value, 1, 200)
                    .map(|value| crossfire_kernel::secret::Secret::new(value.to_owned()))
            })
            .transpose()?,
    })
}
pub fn roster(value: &Value) -> Result<Roster> {
    decode_roster(check::object(
        value,
        &["controller", "ownerMatrixId", "fleetKey", "instances"],
        &["controllerCredential"],
    )?)
}
pub fn introduction(value: &Value) -> Result<Introduction> {
    let value = check::object(
        value,
        &[
            "controller",
            "ownerMatrixId",
            "fleetKey",
            "instances",
            "enrollmentId",
            "claimSecret",
        ],
        &["controllerCredential"],
    )?;
    Ok(Introduction {
        enrollment_id: check::identifier(&value["enrollmentId"])?.to_owned(),
        claim_secret: crossfire_kernel::secret::Secret::new(
            check::secret(&value["claimSecret"])?.to_owned(),
        ),
        roster: decode_roster(value)?,
    })
}
pub fn decision(value: &Value) -> Result<Decision> {
    let value = check::object(
        value,
        &["expectedRevision", "decision", "verificationCode"],
        &[],
    )?;
    Ok(Decision {
        expected_revision: check::integer(&value["expectedRevision"], 0, check::SAFE_INTEGER)?,
        approve: check::choice(&value["decision"], &["approve", "reject"])? == "approve",
        verification_code: check::text(&value["verificationCode"], 12, 12)?.to_owned(),
    })
}
pub fn claim(value: &Value) -> Result<crossfire_kernel::secret::Secret> {
    let value = check::object(value, &["claimSecret"], &[])?;
    Ok(crossfire_kernel::secret::Secret::new(
        check::secret(&value["claimSecret"])?.to_owned(),
    ))
}
pub fn overview(
    request: &Request,
    owner: &crossfire_domain::identity::PrincipalSummary,
) -> Result<Value> {
    Ok(
        json!({"owner":serde_json::to_value(crate::identity::PrincipalView(owner)).map_err(|_| Failure::new(ErrorCode::Unavailable,"Enrollment owner cannot be encoded"))?,"controllerName":request.controller_name,"enrollmentId":request.id,"ownerId":request.owner_id,"fleetKey":request.fleet_key,
        "verificationCode":request.verification_code,"status":request.state.as_str(),"revision":request.revision,"createdAt":request.created_at,"expiresAt":request.expires_at,"decidedByMemberId":request.decided_by_member_id,"decidedAt":request.decided_at}),
    )
}
pub fn details(value: &Receipt, digest: &Digest) -> Result<Value> {
    let instances = value.instances.iter().map(|value| json!({"instanceKey":value.item.instance_key,"requestedName":value.item.requested_name,"currentName":value.current_name,"outcome":value.item.outcome.as_str(),"agentId":value.item.agent_id,"coordinationPolicy":digest.policy(&value.policy)})).collect::<Vec<_>>();
    Ok(json!({"enrollment":overview(&value.request,&value.owner)?,"instances":instances}))
}
pub fn decided(value: &DecisionResult) -> Value {
    json!({"enrollmentId":value.enrollment_id,"status":value.state.as_str(),"revision":value.revision})
}
pub fn exchanged(value: &Exchange) -> Value {
    json!({"status":value.status,"ownerMatrixId":value.owner_matrix_id,"fleet":value.fleet.as_ref().map(|(id,credential)| json!({"fleetId":id,"controllerCredential":credential.as_ref().map(|credential| credential.expose())})),
        "instances":value.instances.iter().map(|value| json!({"instanceKey":value.instance_key,"name":value.name,"agentId":value.agent_id,"status":if value.account.is_some(){"ready"}else{"provisioning"},"errorCode":value.error_code,
            "account":value.account.as_ref().map(|value| json!({"matrixUserId":value.matrix_user_id,"accessToken":value.access_token.expose(),"deviceId":value.device_id}))})).collect::<Vec<_>>()})
}

pub struct Digest(CollatorBorrowed<'static>);
impl Digest {
    pub fn new() -> Result<Self> {
        Ok(Self(
            Collator::try_new(Default::default(), CollatorOptions::default()).map_err(|_| {
                Failure::new(
                    ErrorCode::Unavailable,
                    "Native enrollment collation is unavailable",
                )
            })?,
        ))
    }
    pub fn compare(&self, left: &str, right: &str) -> std::cmp::Ordering {
        self.0.compare(left, right)
    }
    pub fn value(&self, roster: &Roster) -> Result<String> {
        let mut metadata = roster
            .controller
            .metadata
            .iter()
            .map(|(key, value)| (key.as_str(), value.as_str()))
            .collect::<Vec<_>>();
        metadata.sort_by(|left, right| self.compare(left.0, right.0));
        let controller = Controller {
            name: &roster.controller.name,
            metadata,
        };
        let mut items = roster
            .instances
            .iter()
            .map(|item| {
                (
                    item.instance_key.as_str(),
                    item.name.as_str(),
                    item.identity.as_ref().map(|proof| proof.agent_id.as_str()),
                    self.policy(&item.policy),
                )
            })
            .collect::<Vec<_>>();
        items.sort_by(|left, right| self.compare(left.0, right.0));
        serde_json::to_string(&Canonical {
            owner: &roster.owner_matrix_id,
            fleet: &roster.fleet_key,
            controller,
            items,
        })
        .map_err(|_| Failure::new(ErrorCode::Invalid, "Enrollment roster cannot be encoded"))
    }
    fn policy<'a>(&self, value: &'a Policy) -> PolicyWire<'a> {
        let mut senders = value
            .senders
            .iter()
            .map(|sender| Sender {
                matrix_user_id: &sender.matrix_user_id,
                include_agents: sender.include_agents,
            })
            .collect::<Vec<_>>();
        senders.sort_by(|left, right| self.compare(left.matrix_user_id, right.matrix_user_id));
        PolicyWire {
            wake_mode: match value.mode {
                WakeMode::Humans => "humans",
                WakeMode::Everyone => "everyone",
                WakeMode::Selected => "selected",
            },
            senders,
            permissions: if value.invite_agents {
                vec!["room.agent.invite"]
            } else {
                Vec::new()
            },
        }
    }
}
impl RosterDigest for Digest {
    fn digest(&self, roster: &Roster) -> Result<String> {
        Ok(identity::hash(&self.value(roster)?))
    }
}
#[derive(Serialize)]
struct Canonical<'a> {
    owner: &'a str,
    fleet: &'a str,
    controller: Controller<'a>,
    items: Vec<(&'a str, &'a str, Option<&'a str>, PolicyWire<'a>)>,
}
#[derive(Serialize)]
struct Controller<'a> {
    name: &'a str,
    metadata: Vec<(&'a str, &'a str)>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PolicyWire<'a> {
    wake_mode: &'static str,
    senders: Vec<Sender<'a>>,
    permissions: Vec<&'static str>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Sender<'a> {
    matrix_user_id: &'a str,
    include_agents: bool,
}
