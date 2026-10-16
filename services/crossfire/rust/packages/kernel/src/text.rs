pub fn whitespace(character: char) -> bool {
    matches!(character, '\u{9}'..='\u{d}' | '\u{20}' | '\u{a0}' | '\u{1680}' | '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}' | '\u{205f}' | '\u{3000}' | '\u{feff}')
}

pub fn truncate_utf16(value: &str, maximum: usize) -> &str {
    let mut length = 0;
    for (offset, character) in value.char_indices() {
        length += character.len_utf16();
        if length > maximum {
            return &value[..offset];
        }
    }
    value
}

pub fn truncate_utf8(value: &str, maximum: usize) -> &str {
    if value.len() <= maximum {
        return value;
    }
    let mut boundary = maximum;
    while !value.is_char_boundary(boundary) {
        boundary -= 1;
    }
    &value[..boundary]
}
