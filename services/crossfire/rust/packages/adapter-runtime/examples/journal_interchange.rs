use crossfire_adapter_runtime::journal::{self, Journal, NativeMessage};
use crossfire_kernel::Result;
use serde::{Deserialize, Serialize};
use std::{
    io::{Read, Write},
    path::Path,
};

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Message {
    text: String,
    message_id: String,
    published: bool,
}
impl NativeMessage for Message {
    fn text(&self) -> &str {
        &self.text
    }
    fn message_id(&self) -> &str {
        &self.message_id
    }
    fn validate(&self) -> Result<()> {
        journal::validate_message(&self.text, &self.message_id)
    }
}

fn main() -> std::result::Result<(), Box<dyn std::error::Error>> {
    let arguments = std::env::args().skip(1).collect::<Vec<_>>();
    let [action, file] = arguments.as_slice() else {
        return Err("Use journal action and exact private file".into());
    };
    let file = Path::new(file);
    if action == "read" {
        println!(
            "{}",
            serde_json::to_string(&journal::read::<Message>(file, "session")?)?
        );
        return Ok(());
    }
    let mut journal = Journal::<Message>::open(file, "session")?;
    match action.as_str() {
        "prepare" => {
            let mut bytes = Vec::new();
            std::io::stdin().take(4097).read_to_end(&mut bytes)?;
            if bytes.len() > 4096 {
                return Err("Fixture input exceeds bound".into());
            }
            journal.prepare(serde_json::from_slice(&bytes)?)?;
        }
        "confirm" => {
            let input = journal.pending()?.ok_or("Missing fixture input")?;
            journal.complete(&input, true)?;
        }
        "acknowledge" => journal.acknowledge(&["message".to_owned()])?,
        "lock" => {
            println!("owned");
            std::io::stdout().flush()?;
            let mut signal = [0; 1];
            std::io::stdin().read_exact(&mut signal)?;
        }
        _ => return Err("Unknown journal fixture action".into()),
    }
    Ok(())
}
