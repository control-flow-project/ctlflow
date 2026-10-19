use crate::identity::WakeMode;
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BackendSender {
    pub backend_user_id: String,
    pub include_agents: bool,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Policy {
    pub mode: WakeMode,
    pub senders: Vec<BackendSender>,
    pub invite_agents: bool,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RequestedPolicy {
    pub mode: WakeMode,
    pub senders: Vec<crate::wake::Sender>,
    pub invite_agents: bool,
    pub expected_agent_revision: Option<i64>,
}
impl Policy {
    pub fn owner_default(owner: &str) -> Self {
        Self {
            mode: WakeMode::Selected,
            senders: vec![BackendSender {
                backend_user_id: owner.to_owned(),
                include_agents: false,
            }],
            invite_agents: false,
        }
    }
}
