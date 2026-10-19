pub fn opaque(value: &str) -> bool {
    (1..=255).contains(&value.encode_utf16().count())
        && !value
            .chars()
            .any(|value| value <= '\u{1f}' || value == '\u{7f}')
}
