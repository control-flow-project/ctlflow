pub const APPLICATION_ID: i64 = 1129465426;
pub const SCHEMA_VERSION: i64 = 17;
pub const MIGRATIONS: &[&str] = &[
    "20261014000000_initial_schema.mjs",
    "20261014000001_initial_data.mjs",
];

mod identity;
pub use identity::{
    instance_policy, member, member_invitation, member_session, permission, principal,
    principal_application, principal_role, role, role_permission,
};
mod agents;
pub use agents::{
    agent, agent_credential, agent_name, agent_owner_conversation, agent_room_grant,
    agent_room_permission, agent_wake_sender, room_grant_application,
};
mod enrollment;
pub use enrollment::{
    enrollment_archive, enrollment_archive_item, enrollment_archive_metadata,
    enrollment_archive_permission, enrollment_archive_policy, enrollment_archive_wake_sender,
    enrollment_controller_metadata, enrollment_item, enrollment_item_permission,
    enrollment_item_policy, enrollment_item_wake_sender, enrollment_request,
};
mod fleets;
pub use fleets::{
    fleet, fleet_connection, fleet_controller_metadata, fleet_credential, fleet_instance,
    fleet_instance_permission, fleet_instance_policy, fleet_message, fleet_message_delivery,
    fleet_native_stop, fleet_runtime_operation,
};
mod activity;
pub use activity::{
    audit_event, incident_notification, listener_run, listener_stat_checkpoint, listener_stat_flow,
    listener_stat_interval, listener_stat_usage, management_conversation, runtime_decision,
    runtime_decision_answer, runtime_decision_option, runtime_decision_question, runtime_incident,
    runtime_observation, runtime_setting, runtime_usage_checkpoint,
};
mod publications;
pub use publications::{publication, publication_file};
mod wake;
pub use wake::{wake_delivery, wake_notice, wake_rule, wake_rule_agent};
diesel::allow_tables_to_appear_in_same_query!(
    agent,
    agent_credential,
    agent_name,
    agent_owner_conversation,
    agent_room_grant,
    agent_room_permission,
    agent_wake_sender,
    audit_event,
    enrollment_archive,
    enrollment_archive_item,
    enrollment_archive_metadata,
    enrollment_archive_permission,
    enrollment_archive_policy,
    enrollment_archive_wake_sender,
    enrollment_controller_metadata,
    enrollment_item,
    enrollment_item_permission,
    enrollment_item_policy,
    enrollment_item_wake_sender,
    enrollment_request,
    fleet,
    fleet_connection,
    fleet_controller_metadata,
    fleet_credential,
    fleet_instance,
    fleet_instance_permission,
    fleet_instance_policy,
    fleet_message,
    fleet_message_delivery,
    fleet_native_stop,
    fleet_runtime_operation,
    incident_notification,
    instance_policy,
    listener_run,
    listener_stat_checkpoint,
    listener_stat_flow,
    listener_stat_interval,
    listener_stat_usage,
    management_conversation,
    member,
    member_invitation,
    member_session,
    permission,
    principal,
    principal_application,
    principal_role,
    publication,
    publication_file,
    role,
    role_permission,
    room_grant_application,
    runtime_decision,
    runtime_decision_answer,
    runtime_decision_option,
    runtime_decision_question,
    runtime_incident,
    runtime_observation,
    runtime_setting,
    runtime_usage_checkpoint,
    wake_delivery,
    wake_notice,
    wake_rule,
    wake_rule_agent,
);
