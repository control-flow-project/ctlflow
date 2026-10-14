use crossfire_domain::{
    identity::{PrincipalKind, WakeMode},
    wake::{Sender, accepts},
};

#[test]
fn humans_mode_keeps_explicit_agent_and_ownership_selections() {
    let selections = vec![
        Sender {
            principal_id: "owner".to_owned(),
            include_agents: true,
        },
        Sender {
            principal_id: "specific-agent".to_owned(),
            include_agents: false,
        },
    ];
    assert!(accepts(
        "receiver",
        WakeMode::Humans,
        &selections,
        "human",
        PrincipalKind::Human,
        None
    ));
    assert!(accepts(
        "receiver",
        WakeMode::Humans,
        &selections,
        "owners-agent",
        PrincipalKind::Agent,
        Some("owner")
    ));
    assert!(accepts(
        "receiver",
        WakeMode::Humans,
        &selections,
        "specific-agent",
        PrincipalKind::Agent,
        Some("different-owner")
    ));
    assert!(!accepts(
        "receiver",
        WakeMode::Humans,
        &selections,
        "other-agent",
        PrincipalKind::Agent,
        Some("different-owner")
    ));
    assert!(!accepts(
        "receiver",
        WakeMode::Everyone,
        &selections,
        "receiver",
        PrincipalKind::Agent,
        Some("owner")
    ));
}

#[test]
fn selected_mode_has_no_implicit_owner_or_human_access() {
    assert!(!accepts(
        "receiver",
        WakeMode::Selected,
        &[],
        "owner",
        PrincipalKind::Human,
        None
    ));
    let selection = vec![Sender {
        principal_id: "owner".to_owned(),
        include_agents: false,
    }];
    assert!(accepts(
        "receiver",
        WakeMode::Selected,
        &selection,
        "owner",
        PrincipalKind::Human,
        None
    ));
    assert!(!accepts(
        "receiver",
        WakeMode::Selected,
        &selection,
        "owners-agent",
        PrincipalKind::Agent,
        Some("owner")
    ));
}
