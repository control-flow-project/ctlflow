pub fn uuid(value: &str) -> bool {
    value.len() == 36
        && value.bytes().enumerate().all(|(position, character)| {
            if [8, 13, 18, 23].contains(&position) {
                character == b'-'
            } else {
                character.is_ascii_digit() || (b'a'..=b'f').contains(&character)
            }
        })
}

pub fn opaque(value: &str) -> bool {
    (1..=255).contains(&value.encode_utf16().count())
        && !value
            .chars()
            .any(|value| value <= '\u{1f}' || value == '\u{7f}')
}

pub fn name(value: &str) -> bool {
    named(value, false)
}

pub fn agent_name(value: &str) -> bool {
    named(value, true)
}

fn named(value: &str, allow_underscore: bool) -> bool {
    (1..=40).contains(&value.len())
        && value.as_bytes()[0].is_ascii_lowercase()
        && value.bytes().all(|character| {
            character.is_ascii_lowercase()
                || character.is_ascii_digit()
                || character == b'-'
                || allow_underscore && character == b'_'
        })
}
