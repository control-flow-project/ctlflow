#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Scope {
    pub fleet_id: Option<String>,
    pub instance_key: Option<String>,
}
#[derive(Debug, Clone)]
pub struct Check {
    pub id: String,
    pub scope: Scope,
    pub status: String,
    pub observed_at: Option<i64>,
    pub message: String,
    pub remediation: Option<String>,
}
#[derive(Debug, Clone)]
pub struct Report {
    pub checked_at: i64,
    pub scope: Scope,
    pub checks: Vec<Check>,
}
impl Report {
    pub fn add(
        &mut self,
        id: &str,
        scope: &Scope,
        status: &str,
        observed_at: Option<i64>,
        message: &str,
        remediation: Option<&str>,
    ) {
        self.checks.push(Check {
            id: id.to_owned(),
            scope: scope.clone(),
            status: status.to_owned(),
            observed_at,
            message: message.to_owned(),
            remediation: remediation.map(str::to_owned),
        });
    }
}
pub fn listener(
    instance: &crate::controller_model::InstanceState,
    connection: &crate::controller_model::ConnectionState,
    live: bool,
    scope: &Scope,
    checked_at: i64,
) -> Check {
    let (status, message, remediation) = if instance.listener_active {
        ("pass", "Listener delivery is active", None)
    } else if !instance.desired_active {
        (
            "not-applicable",
            "Agent is not selected for listener delivery",
            None,
        )
    } else if live && connection.connected && !connection.delivery_enabled {
        ("pass", "Listener delivery is deliberately paused", None)
    } else if live
        || matches!(
            instance.phase,
            crate::controller_model::InstancePhase::Starting
                | crate::controller_model::InstancePhase::Waking
                | crate::controller_model::InstancePhase::AwaitingApproval
        )
    {
        (
            "unknown",
            "Listener delivery has not been activated",
            Some("Inspect fleet show and any pending enrollment or startup operation"),
        )
    } else {
        (
            "fail",
            "Selected agent has no live listener owner",
            Some("Inspect the agent failure and resume it explicitly if needed"),
        )
    };
    Check {
        id: "agent.listener".to_owned(),
        scope: scope.clone(),
        status: status.to_owned(),
        observed_at: Some(checked_at),
        message: message.to_owned(),
        remediation: remediation.map(str::to_owned),
    }
}
