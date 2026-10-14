use crate::{enrollment::Digest, room_access, validation as check};
use crossfire_domain::{
    matrix::RoomPower,
    room_access::{
        plan::*,
        values::{Access, Change},
    },
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode, identity};
use serde::{Serialize, Serializer, ser::SerializeStruct};
use serde_json::{Value, json};
pub fn plan(value: &Value) -> Result<Plan> {
    let value = check::object(value, &["fleetId", "agents"], &[])?;
    let agents = check::list(&value["agents"], 1, 100)?
        .iter()
        .map(|value| {
            let value = check::object(value, &["instanceKey", "grants"], &[])?;
            let grants = check::list(&value["grants"], 0, 100)?
                .iter()
                .map(|value| {
                    check::object(value, &["roomId", "accessMode", "powerLevel", "muted"], &[])?;
                    Ok(ProposedGrant {
                        room_id: check::room_id(&value["roomId"])?.to_owned(),
                        intent: room_access::intent(value, false)?,
                    })
                })
                .collect::<Result<Vec<_>>>()?;
            Ok(ProposedAgent {
                instance_key: check::name(&value["instanceKey"])?.to_owned(),
                grants,
            })
        })
        .collect::<Result<Vec<_>>>()?;
    Ok(Plan {
        fleet_id: check::identifier(&value["fleetId"])?.to_owned(),
        agents,
    })
}
pub fn snapshots(value: &Value) -> Result<Vec<Snapshot>> {
    check::list(value, 1, 100)?
        .iter()
        .map(|value| {
            let value = check::object(value, &["agentId", "revision", "grants"], &[])?;
            let grants = check::list(&value["grants"], 0, 100)?
                .iter()
                .map(|value| {
                    let value = check::object(value, &["roomId", "generation", "revision"], &[])?;
                    Ok(GrantSnapshot {
                        room_id: check::room_id(&value["roomId"])?.to_owned(),
                        generation: check::identifier(&value["generation"])?.to_owned(),
                        revision: check::integer(&value["revision"], 0, check::SAFE_INTEGER)?,
                    })
                })
                .collect::<Result<Vec<_>>>()?;
            Ok(Snapshot {
                agent_id: check::identifier(&value["agentId"])?.to_owned(),
                revision: check::integer(&value["revision"], 0, check::SAFE_INTEGER)?,
                grants,
            })
        })
        .collect()
}
pub fn snapshot(value: &Snapshot) -> Value {
    json!({"agentId":value.agent_id,"revision":value.revision,"grants":value.grants.iter().map(|value|json!({"roomId":value.room_id,"generation":value.generation,"revision":value.revision})).collect::<Vec<_>>()})
}
pub fn preview(value: &Preview) -> Value {
    json!({"digest":value.digest,"snapshots":value.snapshots.iter().map(snapshot).collect::<Vec<_>>(),"changes":value.changes.iter().map(|value| {
        let proof=&value.authorization;let input=&proof.input;
        json!({"agentId":input.agent_id,"roomId":input.room_id,"agentName":value.agent_name,"instanceKey":value.instance_key,"roomName":value.room_name,"roomAlias":value.room_alias,
            "before":proof.previous.as_ref().map(room_access::grant),"after":if input.intent.access==Access::None{None}else{Some(json!({"roomId":input.room_id,"accessMode":input.intent.access.code(),"powerLevel":input.intent.power,"muted":input.intent.muted}))},
            "changed":proof.changed,"authorizerId":proof.authorizer_id,"nativePowerLevel":proof.native.as_ref().and_then(|facts|match facts.power{RoomPower::Creator=>None,RoomPower::Level(level)=>Some(level)}),
            "nativeCreator":proof.native.as_ref().is_some_and(|facts|facts.power==RoomPower::Creator)})
    }).collect::<Vec<_>>()})
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GrantSnapshotWire<'a> {
    room_id: &'a str,
    generation: &'a str,
    revision: i64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SnapshotWire<'a> {
    agent_id: &'a str,
    revision: i64,
    grants: Vec<GrantSnapshotWire<'a>>,
}
struct InputWire<'a>(&'a Change);
impl Serialize for InputWire<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        let input = self.0;
        let mut value = serializer.serialize_struct("GrantPlanInput", 7)?;
        if input.intent.access != Access::None {
            value.serialize_field("roomId", &input.room_id)?;
        }
        value.serialize_field("accessMode", input.intent.access.code())?;
        value.serialize_field("powerLevel", &input.intent.power)?;
        value.serialize_field("muted", &input.intent.muted)?;
        value.serialize_field("agentId", &input.agent_id)?;
        if input.intent.access == Access::None {
            value.serialize_field("roomId", &input.room_id)?;
        }
        value.serialize_field("expectedRevision", &input.expected_revision)?;
        value.serialize_field("expectedGeneration", &input.expected_generation)?;
        value.end()
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeWire {
    power_level: Option<i64>,
    creator: bool,
    read_level: i64,
    reply_level: i64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ChangeWire<'a> {
    input: InputWire<'a>,
    authorizer_id: &'a str,
    native: Option<NativeWire>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PreviewWire<'a> {
    fleet_id: &'a str,
    fleet_revision: i64,
    snapshots: Vec<SnapshotWire<'a>>,
    changes: Vec<ChangeWire<'a>>,
}
pub fn digest_document(preview: &Preview) -> Result<String> {
    let document = PreviewWire {
        fleet_id: &preview.fleet_id,
        fleet_revision: preview.fleet_revision,
        snapshots: preview
            .snapshots
            .iter()
            .map(|value| SnapshotWire {
                agent_id: &value.agent_id,
                revision: value.revision,
                grants: value
                    .grants
                    .iter()
                    .map(|value| GrantSnapshotWire {
                        room_id: &value.room_id,
                        generation: &value.generation,
                        revision: value.revision,
                    })
                    .collect(),
            })
            .collect(),
        changes: preview
            .changes
            .iter()
            .map(|value| ChangeWire {
                input: InputWire(&value.authorization.input),
                authorizer_id: &value.authorization.authorizer_id,
                native: value.authorization.native.as_ref().map(|facts| NativeWire {
                    power_level: match facts.power {
                        RoomPower::Creator => None,
                        RoomPower::Level(level) => Some(level),
                    },
                    creator: facts.power == RoomPower::Creator,
                    read_level: facts.read_level,
                    reply_level: facts.reply_level,
                }),
            })
            .collect(),
    };
    serde_json::to_string(&document)
        .map_err(|_| Failure::new(ErrorCode::Unavailable, "Room review could not be encoded"))
}
impl PlanEncoding for Digest {
    fn compare(&self, first: &str, second: &str) -> std::cmp::Ordering {
        self.compare(first, second)
    }
    fn digest(&self, preview: &Preview) -> Result<String> {
        Ok(identity::hash(&digest_document(preview)?))
    }
}
