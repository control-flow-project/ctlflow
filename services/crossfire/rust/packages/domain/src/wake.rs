use crate::identity::{PrincipalKind, WakeMode};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Sender {
    pub principal_id: String,
    pub include_agents: bool,
}

pub fn accepts(
    receiver_id: &str,
    mode: WakeMode,
    selections: &[Sender],
    sender_id: &str,
    kind: PrincipalKind,
    owner_id: Option<&str>,
) -> bool {
    sender_id != receiver_id
        && (mode == WakeMode::Everyone
            || mode == WakeMode::Humans && kind == PrincipalKind::Human
            || selections.iter().any(|selection| {
                selection.principal_id == sender_id
                    || kind == PrincipalKind::Agent
                        && selection.include_agents
                        && owner_id == Some(selection.principal_id.as_str())
            }))
}
pub fn resolve(
    repo: &mut (impl crate::port::AgentRepository + crate::port::DiscoveryRepository),
    agent: &crate::identity::Agent,
) -> crossfire_kernel::Result<Vec<String>> {
    let selections = repo.wake_senders(&agent.principal_id)?;
    let mut result = repo
        .active_principals()?
        .into_iter()
        .filter(|value| {
            accepts(
                &agent.principal_id,
                agent.wake_mode,
                &selections,
                &value.principal.id,
                value.principal.kind,
                value.owner_id.as_deref(),
            )
        })
        .map(|value| value.principal.backend_user_id)
        .collect::<Vec<_>>();
    result.sort();
    Ok(result)
}
