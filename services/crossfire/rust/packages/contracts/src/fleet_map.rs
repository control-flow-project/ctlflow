use crate::{enrollment::Digest, identity::PrincipalView, room_access, views};
use crossfire_domain::{
    identity::WakeMode,
    read::{
        map::{Capture, MapEncoding},
        values::ActivityState,
    },
    wake::Sender,
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode, identity};
use serde::Serialize;
use serde_json::{Value, json};
impl MapEncoding for Digest {
    fn source(&self, mode: WakeMode, senders: &[Sender]) -> Result<String> {
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Selection<'a> {
            principal_id: &'a str,
            include_agents: bool,
        }
        let values: Vec<_> = senders
            .iter()
            .map(|value| Selection {
                principal_id: &value.principal_id,
                include_agents: value.include_agents,
            })
            .collect();
        let encoded = serde_json::to_string(&values).map_err(|_| {
            Failure::new(
                ErrorCode::Unavailable,
                "Fleet wake source cannot be encoded",
            )
        })?;
        Ok(identity::hash(&format!(
            "{}\0{encoded}",
            views::wake_mode(mode)
        )))
    }
    fn compare(&self, first: &str, second: &str) -> std::cmp::Ordering {
        self.compare(first, second)
    }
}
pub fn value(capture: &Capture, rooms: Vec<Value>) -> Value {
    json!({"fleet":views::fleet(&capture.fleet),"capturedAt":capture.captured_at,
        "agents":capture.agents.iter().map(|value|json!({"agentId":value.record.view.principal.id,"matrixUserId":value.record.view.principal.matrix_user_id,"instanceKey":value.instance_key,
            "displayName":crossfire_domain::identity::agent_display_name(&value.record.name,&value.record.view.owner_member.display_name),"status":views::status(value.record.view.principal.status),
            "owner":{"memberId":value.record.view.owner.id,"matrixUserId":value.record.view.owner.matrix_user_id,"displayName":value.record.view.owner_member.display_name,"status":views::status(value.record.view.owner.status)},
            "sourceId":value.source_id,"listener":match value.activity.status {ActivityState::Online=>"online",ActivityState::Offline=>"offline",ActivityState::Disconnecting=>"disconnecting"},"lastSeenAt":value.activity.last_seen_at})).collect::<Vec<_>>(),
        "rooms":rooms,"connections":capture.connections.iter().map(|value|json!({"agentId":value.agent_id,"roomId":value.room_id,"grant":value.grant.as_ref().map(room_access::grant),"application":value.application.as_ref().map(room_access::application)})).collect::<Vec<_>>(),
        "sources":capture.sources.iter().map(|value|json!({"sourceId":value.id,"mode":views::wake_mode(value.mode),"senders":value.senders.iter().map(|value|json!({"principalId":value.principal_id,"includeAgents":value.include_agents})).collect::<Vec<_>>(),"eligiblePrincipalIds":value.eligible})).collect::<Vec<_>>(),
        "principals":capture.principals.iter().map(PrincipalView).collect::<Vec<_>>()})
}
