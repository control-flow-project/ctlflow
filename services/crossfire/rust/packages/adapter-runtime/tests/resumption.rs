use crossfire_adapter_filesystem::PrivateDirectory;
use crossfire_adapter_runtime::{journal::NativeMessage, resumption};
use crossfire_kernel::Result;
use serde::{Deserialize, Serialize};
use std::os::unix::fs::MetadataExt;

#[derive(Serialize, Deserialize)]
struct Input {
    text: String,
    id: String,
}
impl NativeMessage for Input {
    fn text(&self) -> &str {
        &self.text
    }
    fn message_id(&self) -> &str {
        &self.id
    }
    fn validate(&self) -> Result<()> {
        crossfire_adapter_runtime::journal::validate_message(&self.text, &self.id)
    }
}
#[test]
fn restart_context_is_written_once_not_replaced_each_receipt_poll_and_tampering_is_rejected()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let state = directory.path().join("state");
    PrivateDirectory::open(&state, true)?;
    let input = Input {
        text: "Original exact source attribution and message.".to_owned(),
        id: "input".to_owned(),
    };
    let receipt = state.join("receipt");
    let file = resumption::retain(&input, &receipt)?;
    let before = std::fs::metadata(&file)?.ino();
    assert_eq!(resumption::retain(&input, &receipt)?, file);
    assert_eq!(
        std::fs::metadata(&file)?.ino(),
        before,
        "Repeated receipt polls reuse the same durable source file"
    );
    let notice = resumption::text(&input, &receipt, directory.path())?;
    assert!(!notice.contains(directory.path().to_str().ok_or("Fixture path")?));
    std::fs::write(&file, b"tampered")?;
    assert!(resumption::retain(&input, &receipt).is_err());
    Ok(())
}
