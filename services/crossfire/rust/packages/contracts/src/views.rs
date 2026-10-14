use crate::identity::PrincipalView;
use crossfire_domain::{
    identity::{Application, MemberView, PrincipalKind, Status, WakeMode},
    listener::Run,
    policy::InstancePolicy,
    read::values::*,
};
use serde_json::{Value, json};
pub fn status(value: Status) -> &'static str {
    match value {
        Status::Active => "active",
        Status::Suspended => "suspended",
        Status::Revoked => "revoked",
    }
}
pub fn kind(value: PrincipalKind) -> &'static str {
    match value {
        PrincipalKind::Human => "human",
        PrincipalKind::Agent => "agent",
    }
}
pub fn wake_mode(value: WakeMode) -> &'static str {
    match value {
        WakeMode::Humans => "humans",
        WakeMode::Everyone => "everyone",
        WakeMode::Selected => "selected",
    }
}
pub fn application(value: &Application) -> Value {
    json!({"appliedRevision":value.applied_revision,"appliedStatus":value.applied_status.map(status),"nativeDisplayName":value.native_display_name,
    "lastAttemptAt":value.last_attempt_at,"lastSuccessAt":value.last_success_at,"errorCode":value.error_code,"errorMessage":value.error_message})
}
pub fn member(value: &MemberView) -> Value {
    json!({"memberId":value.principal.id,"matrixUserId":value.principal.matrix_user_id,"displayName":value.member.display_name,
    "roleCode":match value.role.role {crossfire_domain::identity::Role::Member=>"member",crossfire_domain::identity::Role::Administrator=>"administrator",crossfire_domain::identity::Role::Agent=>"agent"},
    "status":status(value.principal.status),"revision":value.principal.revision,"createdAt":value.principal.created_at,"application":application(&value.application)})
}
pub fn listener(value: &Run) -> Value {
    json!({"runId":value.id,"agentId":value.agent_id,"release":value.release,"controller":value.controller.as_ref().map(|value|json!({"fleetId":value.fleet_id,"connectionId":value.connection_id,"credentialId":value.credential_id})),
    "startedAt":value.started_at,"lastSeenAt":value.last_seen_at,"activeMs":value.active_ms,"messagesDelivered":value.messages_delivered,"stoppedAt":value.stopped_at,"disconnectRequestedAt":value.disconnect_requested_at})
}
pub fn activity(value: &Activity) -> Value {
    json!({"status":match value.status {ActivityState::Online=>"online",ActivityState::Offline=>"offline",ActivityState::Disconnecting=>"disconnecting"},
    "activeMs":value.active_ms,"messagesDelivered":value.messages_delivered,"lastSeenAt":value.last_seen_at,"activeRuns":value.active_runs.iter().map(listener).collect::<Vec<_>>()})
}
pub fn native_summary(value: &crossfire_domain::runtime::values::Summary) -> Value {
    json!({"state":match value.state {crossfire_domain::runtime::values::SummaryState::Native(state)=>state.code(),crossfire_domain::runtime::values::SummaryState::Stopped=>"stopped"},
        "observedAt":value.observed_at,"lastActivityAt":value.last_activity_at,"historyAvailable":value.history_available})
}
pub fn agent(value: &AgentDetails) -> Value {
    let record = &value.record;
    let principal = &record.view.principal;
    let owner = &record.view.owner;
    let deployment = &value.deployment;
    json!({"agentId":principal.id,"matrixUserId":principal.matrix_user_id,"name":record.name,"displayName":crossfire_domain::identity::agent_display_name(&record.name,&record.view.owner_member.display_name),
        "owner":{"memberId":owner.id,"matrixUserId":owner.matrix_user_id,"displayName":record.view.owner_member.display_name,"status":status(owner.status)},"status":status(principal.status),"revision":principal.revision,"createdAt":principal.created_at,
        "application":application(&record.view.application),"activity":activity(&value.activity),"nativeRuntime":value.native_runtime.as_ref().map(native_summary),
        "deployment":{"fleetId":deployment.fleet_id,"fleetKey":deployment.fleet_key,"label":deployment.label,"controllerName":deployment.controller_name,"reportedAt":deployment.reported_at,"instanceKey":deployment.instance_key},
        "canRetire":value.can_retire,"allowedActions":value.allowed_actions})
}
pub fn connection(value: crossfire_domain::fleet::control::ConnectionView) -> Value {
    json!({"online":value.online,"lastSeenAt":value.last_seen_at})
}
pub fn control(value: &crossfire_domain::fleet::control::ControlView) -> Value {
    json!({"fleetId":value.fleet_id,"revision":value.revision,"deliveryEnabled":value.delivery_enabled,"connection":connection(value.connection)})
}
pub fn fleet(value: &FleetDetails) -> Value {
    let fleet = &value.fleet;
    json!({"fleetId":fleet.id,"fleetKey":fleet.fleet_key,"ownerId":fleet.owner_id,"label":fleet.label,"controllerName":fleet.controller_name,
    "metadata":value.metadata,"owner":PrincipalView(&value.owner),"connection":connection(value.connection),"deliveryEnabled":fleet.delivery_enabled,"revision":fleet.revision,"updatedAt":fleet.updated_at,"createdAt":fleet.created_at,"canArchive":value.can_archive,"allowedActions":value.allowed_actions})
}
pub fn policy(value: &InstancePolicy) -> Value {
    json!({"revision":value.revision,"maxOwnerAgents":value.max_owner_agents,"maxAgents":value.max_agents,"maxPending":value.max_pending,"enrollmentSeconds":value.enrollment_seconds,"reconcileSeconds":value.reconcile_seconds,
    "maxMessageBytes":value.max_message_bytes,"fleetIdleTimeoutSeconds":value.fleet_idle_timeout_seconds,"agentInstructions":value.agent_instructions,"signupMode":value.signup_mode,"invitationIssuers":value.invitation_issuers})
}
pub fn identity(value: &PrincipalIdentity) -> Value {
    json!({"matrixUserId":value.matrix_user_id,"kind":value.kind.map_or("unknown",kind),"ownerMatrixId":value.owner_matrix_id,"displayName":value.display_name,"ownerDisplayName":value.owner_display_name})
}
pub fn role(value: &CatalogRole) -> Value {
    json!({"code":value.code,"principalKind":kind(value.principal_kind),"label":value.label})
}
pub fn permission(value: &CatalogPermission) -> Value {
    json!({"code":value.code,"grantScope":value.grant_scope,"description":value.description})
}
pub fn audit(value: &AuditDetails) -> Value {
    let event = &value.event;
    json!({"actor":value.actor.as_ref().map(PrincipalView),"target":value.target.as_ref().map(PrincipalView),"auditId":event.id,"requestId":event.request_id,"actorCredentialId":event.actor_credential_id,
    "actorKind":event.actor_kind,"actorPrincipalId":event.actor_principal_id,"ownerId":event.owner_id,"targetKind":event.target_kind,"targetId":event.target_id,"roomId":event.room_id,"membershipGeneration":event.membership_generation,"authorizerId":event.authorizer_id,
    "addedById":event.added_by_id,"permissionCode":event.permission_code,"action":event.action,"outcome":event.outcome,"message":event.message,"createdAt":event.created_at})
}
