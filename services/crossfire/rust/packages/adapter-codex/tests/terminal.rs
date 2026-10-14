use crossfire_adapter_codex::terminal::CodexTerminal;
use crossfire_agent_core::owned_runtime::{Attachment, Terminal};
use crossfire_kernel::identity;
use std::collections::BTreeMap;

fn attachment() -> Attachment {
    Attachment {
        runtime: "codex".to_owned(),
        session_id: identity::id(),
        workspace: "/workspace/owner's project".into(),
        connection: BTreeMap::from([
            ("endpoint".to_owned(), "ws://127.0.0.1:8000".to_owned()),
            ("tokenFile".to_owned(), "/private/token".to_owned()),
            ("home".to_owned(), "/private/home".to_owned()),
            ("binary".to_owned(), "codex".to_owned()),
            ("path".to_owned(), "/usr/bin".to_owned()),
        ]),
    }
}

#[test]
fn terminal_command_resumes_exact_owned_history_without_embedding_private_credentials()
-> Result<(), Box<dyn std::error::Error>> {
    let attachment = attachment();
    let command = CodexTerminal.command(&attachment)?;
    assert!(command.contains("FLEET_RUNTIME_AUTH_TOKEN=\"$(cat -- '/private/token')\""));
    assert!(command.contains("'--remote-auth-token-env' 'FLEET_RUNTIME_AUTH_TOKEN'"));
    assert!(command.contains("'/workspace/owner'\\''s project'"));
    assert!(command.ends_with(&format!("'resume' '{}'", attachment.session_id)));
    Ok(())
}
#[test]
fn terminal_attachment_rejects_remote_authority_control_codes_and_extra_parameters() {
    for endpoint in [
        "ws://public.example:8000",
        "ws://127.0.0.1:8000?token=secret",
        "http://127.0.0.1:8000",
    ] {
        let mut attachment = attachment();
        attachment
            .connection
            .insert("endpoint".to_owned(), endpoint.to_owned());
        assert!(CodexTerminal.command(&attachment).is_err());
    }
    let mut bad = attachment();
    bad.connection
        .insert("legacy".to_owned(), "value".to_owned());
    assert!(CodexTerminal.command(&bad).is_err());
    let mut bad = attachment();
    bad.connection
        .insert("tokenFile".to_owned(), "/private/token\nunsafe".to_owned());
    assert!(CodexTerminal.command(&bad).is_err());
}
