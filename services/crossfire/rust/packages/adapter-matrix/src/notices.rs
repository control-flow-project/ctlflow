use serde_json::{Value, json};

pub fn content(text: &str) -> Value {
    json!({"msgtype":"m.notice","body":text,"org.crossfire.listener_notice":true})
}
pub fn fits(text: &str) -> bool {
    serde_json::to_vec(&content(text)).is_ok_and(|value| value.len() <= 50_000)
}
pub fn chunks(text: &str) -> Vec<String> {
    let budget = 50_000 - content("").to_string().len();
    let mut result = Vec::new();
    let mut selected = String::new();
    let mut size = 0;
    for character in text.chars() {
        let bytes = json!(character.to_string()).to_string().len() - 2;
        if size + bytes > budget {
            result.push(std::mem::take(&mut selected));
            size = 0;
        }
        selected.push(character);
        size += bytes;
    }
    if !selected.is_empty() {
        result.push(selected);
    }
    result
}
