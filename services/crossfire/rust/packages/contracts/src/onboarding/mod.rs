mod guide;
use serde_json::{Value, json};
pub fn descriptor(origin: &str, owner: &str, version: &str, instructions: &str) -> Value {
    json!({"schemaVersion":1,"server":origin,"ownerMatrixId":owner,"package":{"name":"@ctlflow/fleet","version":version},"instructions":instructions})
}
fn quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}
pub fn guide(origin: &str, owner: &str, version: &str, instructions: &str) -> String {
    let url = quote(&format!(
        "{origin}/onboarding/setup.json?ownerMatrixId={}",
        crate::origin::segment(owner)
    ));
    let mut value = String::new();
    for part in guide::GUIDE {
        value.push_str(match part {
            guide::Part::Text(text) => text,
            guide::Part::Origin => origin,
            guide::Part::Owner => owner,
            guide::Part::Version => version,
            guide::Part::Descriptor => &url,
        });
    }
    if !instructions.is_empty() {
        value.push_str("\n## Instructions from this instance’s administrator\n");
        value.push_str(instructions);
        value.push('\n');
    }
    value
}
