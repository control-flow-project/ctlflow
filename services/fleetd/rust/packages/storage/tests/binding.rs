use crossfire_agent_core::{local_state::LocalState, profile::Account};
use crossfire_kernel::secret::Secret;
use fleetd_domain::{
    binding::{Claim, Identity},
    model::{Configuration, Coordination, Roster},
};
use fleetd_storage::binding;
use std::{
    collections::BTreeMap,
    os::unix::fs::{MetadataExt, PermissionsExt},
};

#[test]
fn fleet_bindings_use_the_shared_private_directory_and_preserve_exact_identity_credential_and_explicit_history_initialization()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    std::fs::set_permissions(directory.path(), std::fs::Permissions::from_mode(0o755))?;
    let configuration = Configuration {
        directory: directory.path().to_owned(),
        roster: Roster {
            fleet: "research".to_owned(),
            coordination: Coordination {
                server: "http://localhost:3000".to_owned(),
                owner: "@owner:local".to_owned(),
            },
            instances: Vec::new(),
        },
        definitions: BTreeMap::new(),
        digest: "0".repeat(64),
    };
    let storage = binding::open(&configuration)?;
    let mut selected = binding::load(&storage, &configuration)?;
    assert!(selected.fleet_id.is_none());
    selected.fleet_id = Some("00000000-0000-4000-8000-000000000001".to_owned());
    selected.controller_credential = Some(Secret::new("controller-private".to_owned()));
    selected.identities.push(Identity {
        instance_key: "analyst".to_owned(),
        name: "analyst-max".to_owned(),
        agent_id: "00000000-0000-4000-8000-000000000002".to_owned(),
        account: Account {
            user_id: "@agent:local".to_owned(),
            access_token: Secret::new("agent-private".to_owned()),
            native: serde_json::from_value(serde_json::json!({"deviceId":"DEVICE"}))?,
        },
    });
    selected.request = Some(Claim {
        enrollment_id: "00000000-0000-4000-8000-000000000003".to_owned(),
        claim_secret: Secret::new("a".repeat(43)),
        digest: "f".repeat(64),
    });
    binding::save(&storage, &selected)?;
    let restored = binding::load(&storage, &configuration)?;
    assert_eq!(
        restored.identities[0].account.access_token.expose(),
        "agent-private"
    );
    assert_eq!(
        restored.controller_credential.as_ref().map(Secret::expose),
        Some("controller-private")
    );
    assert!(!format!("{restored:?}").contains("agent-private"));
    assert!(!format!("{restored:?}").contains("controller-private"));
    assert_eq!(
        std::fs::metadata(directory.path().join(".fleet"))?.mode() & 0o777,
        0o700
    );
    assert_eq!(
        std::fs::metadata(directory.path().join(".fleet/binding.json"))?.mode() & 0o777,
        0o600
    );
    let agent = &restored.identities[0].agent_id;
    assert!(!binding::can_initialize(&storage, agent)?);
    binding::initialize(&storage, agent, None)?;
    assert!(binding::can_initialize(&storage, agent)?);
    binding::initialized(&storage, agent)?;
    assert!(!binding::can_initialize(&storage, agent)?);
    assert!(storage.read("../credentials.json", 65536).is_err());
    Ok(())
}
