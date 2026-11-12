use super::request::{Request, invalid};
use crossfire_adapter_filesystem::PrivateDirectory;
use crossfire_kernel::Result;
use serde_json::json;

pub fn write(
    request: &Request,
    started: i64,
    ready: Option<i64>,
    ended: Option<i64>,
    error: Option<&str>,
) -> Result<()> {
    let state = if error.is_some() {
        "failed"
    } else if ended.is_some() {
        "closed"
    } else if ready.is_some() {
        "ready"
    } else {
        "starting"
    };
    let mut value = json!({"id":request.id,"state":state,"startedAt":started});
    if let Some(ready) = ready {
        value["readyAt"] = json!(ready);
    }
    if let Some(ended) = ended {
        value["endedAt"] = json!(ended);
    }
    if let Some(error) = error {
        value["error"] = json!(crossfire_kernel::text::truncate_utf16(error, 8192));
    }
    PrivateDirectory::open(&request.native.directory, false)?.write_atomic(
        "vm-receipt.json",
        &serde_json::to_vec(&value).map_err(|_| invalid("Cannot encode VM receipt"))?,
    )
}
