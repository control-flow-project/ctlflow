use crossfire_kernel::text::{truncate_utf8, truncate_utf16};

#[test]
fn bounds_preserve_whole_unicode_scalars_in_the_selected_wire_unit() {
    for (value, maximum, expected) in [
        ("a🚀b", 2, "a"),
        ("a🚀b", 3, "a🚀"),
        ("🚀", 0, ""),
        ("🚀", 1, ""),
        ("🚀", 2, "🚀"),
    ] {
        assert_eq!(truncate_utf16(value, maximum), expected);
    }
    for (value, maximum, expected) in [
        ("a🚀b", 4, "a"),
        ("a🚀b", 5, "a🚀"),
        ("éé", 3, "é"),
        ("東京", 5, "東"),
        ("🚀", 0, ""),
        ("🚀", 4, "🚀"),
    ] {
        assert_eq!(truncate_utf8(value, maximum), expected);
        assert!(truncate_utf8(value, maximum).len() <= maximum);
    }
}
