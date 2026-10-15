use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use std::collections::{BTreeMap, BTreeSet};

pub struct Arguments {
    pub words: Vec<String>,
    pub options: BTreeMap<String, String>,
}
impl Arguments {
    pub fn get(&self, key: &str) -> Option<&str> {
        self.options.get(key).map(String::as_str)
    }
    pub fn has(&self, key: &str) -> bool {
        self.options.contains_key(key)
    }
}
pub fn invalid(message: impl Into<String>) -> Failure {
    Failure::new(ErrorCode::Invalid, message)
}
pub fn parse(values: Vec<String>) -> Result<Arguments> {
    let strings = [
        "root",
        "remote",
        "name",
        "descriptor",
        "config",
        "ssh",
        "definition",
        "context",
        "text",
        "message-id",
        "operation-id",
        "release-directory",
    ];
    let mut words = vec![];
    let mut options = BTreeMap::new();
    let mut literal = false;
    let mut input = values.into_iter();
    while let Some(value) = input.next() {
        if literal || !value.starts_with('-') {
            words.push(value);
            continue;
        }
        if value == "--" {
            literal = true;
            continue;
        }
        let option = value
            .strip_prefix("--")
            .ok_or_else(|| invalid("Unknown command option"))?;
        let (key, inline) = option
            .split_once('=')
            .map(|(key, value)| (key, Some(value)))
            .unwrap_or((option, None));
        let argument = if ["help", "fresh-history"].contains(&key) {
            if inline.is_some() {
                return Err(invalid("Boolean options take no value"));
            }
            "true".to_owned()
        } else if !strings.contains(&key) {
            return Err(invalid(format!("Unknown option --{key}")));
        } else {
            inline
                .map(str::to_owned)
                .or_else(|| input.next())
                .filter(|value| !value.starts_with("--"))
                .ok_or_else(|| invalid(format!("Missing option --{key}")))?
        };
        if argument.is_empty() || options.insert(key.to_owned(), argument).is_some() {
            return Err(invalid(format!("Duplicated or empty option --{key}")));
        }
    }
    let command = words.first().map(String::as_str).unwrap_or("");
    let action = words.get(1).map(String::as_str).unwrap_or("");
    let mut allowed = BTreeSet::from(["root", "remote", "help"]);
    if command == "remote" {
        allowed.insert("ssh");
    }
    if command == "setup" {
        allowed.extend(["descriptor", "config"]);
    }
    if command == "daemon" && action == "start" {
        allowed.insert("name");
    }
    if command == "agent" && action == "add" {
        allowed.insert("definition");
    }
    if command == "agent" && action == "attach" {
        allowed.insert("context");
    }
    if ["enroll", "start", "stop", "update"].contains(&command)
        || command == "agent" && ["start", "stop", "update"].contains(&action)
    {
        allowed.insert("operation-id");
    }
    if command == "update" || command == "agent" && action == "update" {
        allowed.insert("release-directory");
    }
    if command == "start" || command == "agent" && action == "start" {
        allowed.insert("fresh-history");
    }
    if command == "message" {
        allowed.extend(["text", "message-id"]);
    }
    if options.keys().any(|key| !allowed.contains(key.as_str())) {
        return Err(invalid("An option is not valid for this command"));
    }
    Ok(Arguments { words, options })
}
pub const USAGE: &str = "fleet setup [--descriptor PERSONALIZED_SETUP_URL] [--config /absolute/runtime.toml] [--root DIRECTORY]\nfleet daemon start|status|stop|restart [--root DIRECTORY]\nfleet remote add NAME --ssh USER@HOST --root DIRECTORY\nfleet [--root DIRECTORY | --remote NAME] add DIRECTORY\nfleet list|show|test|enroll|start|stop|remove|activate|deactivate FLEET\nfleet start FLEET [--fresh-history] [--operation-id UUID]\nfleet update FLEET [--release-directory DIRECTORY] [--operation-id UUID]\nfleet message FLEET --text TEXT [--message-id UUID]\nfleet agent list FLEET\nfleet agent add FLEET INSTANCE --definition DEFINITION\nfleet agent start|stop|update|remove|contexts|attach FLEET INSTANCE [--context CONTEXT]\nStart resumes retained history; --fresh-history explicitly replaces it.\nStop retains histories and pauses selected bindings. Daemon shutdown retains desired activation.\nAttach prints a pointer without waking or replacing a native session.";
