use crossfire_contracts::room_plan;
use crossfire_domain::{
    messaging::RoomFacts,
    room_access::{
        plan::{NamedChange, Preview, Snapshot},
        values::{Access, Admission, Authorization, Change, Intent},
    },
};

#[test]
fn room_plan_preview_matches_the_shared_response_contract() -> Result<(), Box<dyn std::error::Error>>
{
    let agent = "00000000-0000-4000-8000-000000000001";
    let owner = "00000000-0000-4000-8000-000000000002";
    let preview = Preview {
        digest: "0".repeat(64),
        fleet_id: "00000000-0000-4000-8000-000000000003".into(),
        fleet_revision: 0,
        snapshots: vec![Snapshot {
            agent_id: agent.into(),
            revision: 0,
            grants: vec![],
        }],
        changes: vec![NamedChange {
            authorization: Authorization {
                input: Change {
                    agent_id: agent.into(),
                    room_id: "control".into(),
                    expected_revision: 0,
                    expected_generation: None,
                    intent: Intent {
                        access: Access::Reply,
                        native_access: None,
                        muted: false,
                    },
                },
                previous: None,
                actor_revision: 0,
                target_revision: 0,
                owner_revision: 0,
                inviter_generation: None,
                inviter_revision: None,
                authorizer_id: owner.into(),
                native: Some(RoomFacts {
                    room_id: "control".into(),
                    name: "Independent room".into(),
                    topic: "".into(),
                    alias: None,
                    backend_user_id: "person/東京".into(),
                    can_invite: true,
                    authority_revision: "opaque-revision".into(),
                    access_modes: vec![Access::Reply],
                    access_fields: vec![],
                    permissions: vec![],
                }),
                changed: true,
                invitation_event_id: None,
                admission: Admission::Managed,
            },
            agent_name: "analyst-high".into(),
            instance_key: "analyst".into(),
            room_name: "Independent room".into(),
            room_alias: None,
        }],
    };
    let value = room_plan::preview(&preview);
    assert_eq!(
        value["changes"][0]["authority"]["backendUserId"],
        "person/東京"
    );
    let output = std::process::Command::new("node")
        .args(["--input-type=module", "-e",
            "import {preview} from '@ctlflow/crossfire-contracts/schema/plan'; const parsed=preview(JSON.parse(process.argv[1])); if(!parsed.ok) throw new Error(parsed.error.message);",
            &serde_json::to_string(&value)?])
        .output()?;
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
            .chars()
            .take(4096)
            .collect::<String>()
    );
    Ok(())
}
