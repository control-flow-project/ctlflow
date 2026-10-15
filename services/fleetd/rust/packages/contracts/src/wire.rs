use crossfire_domain::runtime::values::HistoryMode;
use fleetd_domain::{controller_model::*, model::Instance};
use serde_json::{Value, json};

pub fn controller(value: &ControllerIdentity) -> Value {
    let mut wire = json!({"name":value.name});
    if let Some(metadata) = &value.metadata {
        wire["metadata"] = json!(metadata);
    }
    wire
}
pub fn instance(value: &Instance) -> Value {
    let mut wire = json!({"key":value.key,"name":value.name,"definition":value.definition,"workarea":value.workarea});
    if let Some(workspace) = &value.workspace {
        wire["workspace"] = json!(workspace);
    }
    if let Some(options) = &value.runtime_options {
        wire["runtimeOptions"] = json!(options);
    }
    if value.history_mode == Some(HistoryMode::PerRoom) {
        wire["listenerOptions"] = json!({"historyMode":"per-room"});
    }
    wire
}
pub fn instance_state(value: &InstanceState) -> Value {
    json!({"instance":instance(&value.instance),"phase":value.phase.code(),"listenerActive":value.listener_active,"desiredActive":value.desired_active,"lastActivityAt":value.last_activity_at,"historyAvailable":value.history_available,"sessionId":value.session_id,"error":value.error,"startedAt":value.started_at})
}
pub fn state(value: &FleetState) -> Value {
    let record = &value.registration;
    json!({"fleetId":record.fleet_id,"fleetKey":record.fleet_key,"label":record.label,"directory":record.directory,"revision":record.revision,"controller":controller(&value.controller),"resumeInstanceKeys":value.resume_instance_keys,"phase":value.phase.code(),"instances":value.instances.iter().map(instance_state).collect::<Vec<_>>(),"error":value.error,"connection":{"connected":value.connection.connected,"deliveryEnabled":value.connection.delivery_enabled,"revision":value.connection.revision,"error":value.connection.error}})
}
