use crate::websocket;
use crossfire_adapter_process::ssh_commands::{self, SshExecution};
use crossfire_agent_core::owned_runtime::{Attachment, Terminal};
use crossfire_contracts::validation;
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use serde_json::json;
use std::path::Path;

pub struct CodexTerminal;
fn invalid() -> Failure {
    Failure::new(ErrorCode::Invalid, "Invalid Codex terminal attachment")
}
fn quote(value: &str) -> String {
    "'".to_owned() + &value.replace('\'', "'\\''") + "'"
}

impl Terminal for CodexTerminal {
    fn command(&self, attachment: &Attachment) -> Result<String> {
        let transport = attachment
            .connection
            .get("transport")
            .ok_or_else(invalid)?
            .as_str();
        let names: &[&str] = match transport {
            "host" => &[
                "endpoint",
                "tokenFile",
                "home",
                "binary",
                "path",
                "transport",
            ],
            "ssh" => &[
                "endpoint",
                "tokenFile",
                "home",
                "binary",
                "path",
                "transport",
                "executionDirectory",
                "executionId",
            ],
            _ => return Err(invalid()),
        };
        if attachment.runtime != "codex"
            || attachment.connection.len() != names.len()
            || names
                .iter()
                .any(|name| !attachment.connection.contains_key(*name))
        {
            return Err(invalid());
        }
        validation::identifier(&json!(attachment.session_id))?;
        let field = |name: &str, maximum| {
            attachment
                .connection
                .get(name)
                .filter(|value| {
                    !value.is_empty()
                        && value.encode_utf16().count() <= maximum
                        && !value
                            .chars()
                            .any(|value| value <= '\u{1f}' || value == '\u{7f}')
                })
                .map(String::as_str)
                .ok_or_else(invalid)
        };
        let endpoint = field("endpoint", 2048)?;
        let token_file = field("tokenFile", 4096)?;
        let home = field("home", 4096)?;
        let binary = field("binary", 4096)?;
        let path = field("path", 4096)?;
        websocket::validate_endpoint(endpoint)?;
        let workspace = attachment.workspace.to_str().ok_or_else(invalid)?;
        if !attachment.workspace.is_absolute()
            || !Path::new(token_file).is_absolute()
            || !Path::new(home).is_absolute()
            || workspace
                .chars()
                .any(|value| value <= '\u{1f}' || value == '\u{7f}')
        {
            return Err(invalid());
        }
        let arguments = [
            binary,
            "--remote",
            endpoint,
            "--remote-auth-token-env",
            "FLEET_RUNTIME_AUTH_TOKEN",
            "--cd",
            workspace,
            "resume",
            &attachment.session_id,
        ];
        let command = format!(
            "PATH={} CODEX_HOME={} FLEET_RUNTIME_AUTH_TOKEN=\"$(cat -- {})\" {}",
            quote(path),
            quote(home),
            quote(token_file),
            arguments
                .into_iter()
                .map(quote)
                .collect::<Vec<_>>()
                .join(" ")
        );
        if transport == "host" {
            Ok(command)
        } else {
            ssh_commands::terminal(
                &SshExecution {
                    directory: field("executionDirectory", 4096)?.into(),
                    id: field("executionId", 36)?.to_owned(),
                },
                &attachment.workspace,
                &command,
            )
        }
    }
}
