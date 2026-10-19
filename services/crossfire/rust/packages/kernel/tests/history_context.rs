use crossfire_kernel::history_context::{MAXIMUM_LENGTH, for_room, room, valid};

#[test]
fn opaque_rooms_cannot_collide_with_private_contexts() {
    for value in [
        "shared",
        "control",
        "room/x",
        "__proto__",
        "é/🙂",
        &"a".repeat(255),
    ] {
        let context = for_room(value);
        assert_eq!(room(&context), Some(value));
        assert!(valid(&context));
        assert!(!matches!(context.as_str(), "shared" | "control"));
        assert!(context.encode_utf16().count() <= MAXIMUM_LENGTH);
    }
    assert_eq!(room("shared"), None);
    assert_eq!(room("control"), None);
    assert!(valid("shared") && valid("control"));
    for value in ["", &"a".repeat(256), "bad\nroom", "\u{7f}"] {
        assert!(!valid(&for_room(value)));
    }
}
