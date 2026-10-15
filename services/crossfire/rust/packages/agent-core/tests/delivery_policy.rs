use crossfire_agent_core::delivery_policy::{Policy, Room, history_context};
use crossfire_domain::{room_access::values::Access, runtime::values::HistoryMode};
use std::collections::{BTreeMap, BTreeSet};
#[test]
fn listener_policy_separates_wake_read_reply_and_shared_or_room_history_without_inventing_wire_generations()
 {
    let policy = Policy {
        mode: crossfire_domain::identity::WakeMode::Selected,
        active: true,
        rooms: BTreeMap::from([
            (
                "!read:example.test".to_owned(),
                Room {
                    access: Access::Read,
                    power: None,
                    muted: false,
                },
            ),
            (
                "!reply:example.test".to_owned(),
                Room {
                    access: Access::Reply,
                    power: None,
                    muted: false,
                },
            ),
        ]),
        senders: BTreeSet::from(["@owner:example.test".to_owned()]),
        max_message_bytes: 65536,
        idle_timeout_seconds: 1800,
        owner_conversation: None,
    };
    assert!(policy.accepts("!read:example.test", "@owner:example.test"));
    assert!(!policy.can_reply("!read:example.test"));
    assert!(policy.can_reply("!reply:example.test"));
    assert!(!policy.accepts("!reply:example.test", "@unknown:example.test"));
    assert!(!policy.accepts("!unbound:example.test", "@owner:example.test"));
    assert_eq!(
        history_context(HistoryMode::Shared, "!reply:example.test"),
        "shared"
    );
    assert_eq!(
        history_context(HistoryMode::PerRoom, "!reply:example.test"),
        "!reply:example.test"
    );
    let mut next = policy.clone();
    if let Some(room) = next.rooms.get_mut("!reply:example.test") {
        room.muted = true;
    }
    assert_eq!(
        policy.changed_rooms(&next),
        BTreeSet::from(["!reply:example.test".to_owned()])
    );
    assert!(!next.accepts("!reply:example.test", "@owner:example.test"));
    next.active = false;
    assert!(!next.accepts("!read:example.test", "@owner:example.test"));
    assert!(!next.can_reply("!reply:example.test"));
}
