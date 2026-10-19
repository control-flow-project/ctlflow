use crate::configuration;
use crossfire_adapter_filesystem::{
    PrivateDirectory,
    owned::{DirectoryAccess, validate_directory},
};
use crossfire_contracts::{origin, validation as check};
use crossfire_kernel::{Failure, Result, failure::ErrorCode, identity};
use fleetd_domain::controller_model::{SetupConfiguration, SetupRequest};
use serde_json::{Value, json};
use std::{
    collections::BTreeSet,
    path::{Path, PathBuf},
    sync::Mutex,
};

#[derive(Clone)]
struct Record {
    directory: PathBuf,
    operation_id: String,
    completed: bool,
    server: String,
    owner: String,
    workspace: PathBuf,
    instructions: String,
}
impl Record {
    fn value(&self) -> Value {
        json!({"directory":self.directory,"operationId":self.operation_id,"completed":self.completed,"server":self.server,"owner":self.owner,"workspace":self.workspace,"instructions":self.instructions})
    }
}
pub struct Setup {
    root: PathBuf,
    directory: PrivateDirectory,
    gate: Mutex<()>,
}
fn invalid(message: &str) -> Failure {
    Failure::new(ErrorCode::Invalid, message)
}
impl Setup {
    pub fn open(root: &Path) -> Result<Self> {
        Ok(Self {
            root: root.to_owned(),
            directory: PrivateDirectory::open(root, false)?,
            gate: Mutex::new(()),
        })
    }
    fn read(&self) -> Result<Vec<Record>> {
        let Some(bytes) = self.directory.read_optional("setups.json", 2097152)? else {
            return Ok(Vec::new());
        };
        let value: Value = serde_json::from_slice(&bytes)
            .map_err(|_| invalid("Invalid private setup registry"))?;
        let mut ids = BTreeSet::new();
        let mut directories = BTreeSet::new();
        check::list(&value, 0, 1000)?
            .iter()
            .map(|record| {
                let source = check::object(
                    record,
                    &[
                        "directory",
                        "operationId",
                        "completed",
                        "server",
                        "owner",
                        "workspace",
                        "instructions",
                    ],
                    &[],
                )?;
                let directory = PathBuf::from(check::text(&source["directory"], 1, 4096)?);
                let operation_id = check::identifier(&source["operationId"])?.to_owned();
                if !directory.is_absolute()
                    || !directories.insert(directory.clone())
                    || !ids.insert(operation_id.clone())
                {
                    return Err(invalid("Invalid or duplicate saved setup authority"));
                }
                let completed = source["completed"]
                    .as_bool()
                    .ok_or_else(|| invalid("Invalid setup completion state"))?;
                let server = check::text(&source["server"], 1, 2048)?.to_owned();
                origin::parse(&server)?;
                let owner = check::backend_user_id(&source["owner"])?.to_owned();
                let workspace = PathBuf::from(check::text(&source["workspace"], 1, 4096)?);
                if !workspace.is_absolute() {
                    return Err(invalid("Invalid saved project workspace"));
                }
                let instructions = check::plain_text(&source["instructions"], 131072)?.to_owned();
                Ok(Record {
                    directory,
                    operation_id,
                    completed,
                    server,
                    owner,
                    workspace,
                    instructions,
                })
            })
            .collect()
    }
    fn save(&self, records: &[Record]) -> Result<()> {
        let bytes = serde_json::to_vec(&records.iter().map(Record::value).collect::<Vec<_>>())
            .map_err(|_| invalid("Setup registry encoding failed"))?;
        if bytes.len() > 2097152 {
            return Err(Failure::new(
                ErrorCode::BodyTooLarge,
                "Private setup registry exceeds its size limit",
            ));
        }
        self.directory.write_atomic("setups.json", &bytes)
    }
    pub fn prepare(&self, input: &SetupRequest) -> Result<SetupConfiguration> {
        let _gate = self
            .gate
            .lock()
            .map_err(|_| invalid("Setup state ownership failed"))?;
        validate_directory(&input.workspace, DirectoryAccess::Workspace)?;
        let encode = |value: &str| {
            serde_json::to_string(value).map_err(|_| invalid("Setup authority encoding failed"))
        };
        let workspace = input
            .workspace
            .to_str()
            .ok_or_else(|| invalid("Workspace must be UTF-8"))?;
        let digest = identity::hash(&format!(
            "{{\"workspace\":{},\"server\":{},\"owner\":{}}}",
            encode(workspace)?,
            encode(&input.descriptor.server)?,
            encode(&input.descriptor.owner)?
        ));
        let directory = match &input.configuration {
            Some(path) => {
                if !path.is_absolute()
                    || path.file_name().and_then(|name| name.to_str()) != Some("runtime.toml")
                {
                    return Err(invalid(
                        "Configuration must be an absolute runtime.toml path",
                    ));
                }
                path.parent()
                    .ok_or_else(|| invalid("Configuration directory is missing"))?
                    .to_owned()
            }
            None => self.root.join("projects").join(&digest),
        };
        let mut records = self.read()?;
        let previous = records
            .iter()
            .find(|record| record.directory == directory)
            .cloned();
        if previous.as_ref().is_some_and(|record| {
            record.server != input.descriptor.server
                || record.owner != input.descriptor.owner
                || record.workspace != input.workspace
        }) {
            return Err(Failure::new(
                ErrorCode::Conflict,
                "Saved setup authority or workspace differs; identities are never silently reassigned",
            ));
        }
        if input.configuration.is_none() && previous.is_none() {
            let projects = self.directory.child("projects", true)?;
            if projects.child_optional(&digest, false)?.is_none() {
                self.generate(&projects, &digest, input)?;
            }
        }
        let configuration = configuration::load(&directory, None)?;
        if configuration.roster.coordination.server != input.descriptor.server
            || configuration.roster.coordination.owner != input.descriptor.owner
        {
            return Err(Failure::new(
                ErrorCode::Conflict,
                "Configuration authority must match the verified setup descriptor",
            ));
        }
        if configuration.roster.instances.is_empty() {
            return Err(invalid("Setup requires at least one configured agent"));
        }
        let record = previous.unwrap_or_else(|| Record {
            directory: directory.clone(),
            operation_id: identity::id(),
            completed: false,
            server: input.descriptor.server.clone(),
            owner: input.descriptor.owner.clone(),
            workspace: input.workspace.clone(),
            instructions: input.descriptor.instructions.clone(),
        });
        if !records.iter().any(|current| current.directory == directory) {
            if records.len() >= 1000 {
                return Err(Failure::new(
                    ErrorCode::Capacity,
                    "Private setup registry is full",
                ));
            }
            records.push(record.clone());
            self.save(&records)?;
        }
        let private = PrivateDirectory::open(&directory.join(".fleet"), true)?;
        let instructions = serde_json::to_vec(&json!({"instructions":record.instructions}))
            .map_err(|_| invalid("Setup instructions encoding failed"))?;
        if instructions.len() > 262144 {
            return Err(Failure::new(
                ErrorCode::BodyTooLarge,
                "Setup instructions exceed their private file bound",
            ));
        }
        private.write_atomic("setup-instructions.json", &instructions)?;
        Ok(SetupConfiguration {
            configuration: configuration::load(&directory, None)?,
            operation_id: record.operation_id,
            completed: record.completed,
        })
    }
    fn generate(
        &self,
        projects: &PrivateDirectory,
        digest: &str,
        input: &SetupRequest,
    ) -> Result<()> {
        let staging_name = format!(".setup-{}", identity::id());
        let staging = projects.child(&staging_name, true)?;
        let result = (|| {
            let role = staging.child("agents", true)?.child("project", true)?;
            let project = input
                .workspace
                .file_name()
                .and_then(|name| name.to_str())
                .ok_or_else(|| invalid("Project workspace needs a name"))?;
            let name = generated_name(project, digest);
            let roster = json!({"fleet":name,"coordination":{"adapter":"crossfire","server":input.descriptor.server,"owner":input.descriptor.owner},"instances":[{"key":name,"name":name,"definition":"project","workarea":format!("agents/project/workarea/{name}"),"workspace":input.workspace}]});
            staging.write_new("runtime.toml", configuration::format(&roster)?.as_bytes())?;
            let definition = json!({"name":crossfire_kernel::text::truncate_utf16(project, 100),"runtime":"codex","runtime_options":{"sandbox_mode":"danger-full-access","approval_policy":"on-request","dangerously_bypass_approvals_and_sandbox":false}});
            role.write_new("agent.toml", configuration::format(&definition)?.as_bytes())?;
            role.write_new("AGENTS.md", b"Work in the configured project workspace. Follow its instructions and the authorized human requests. This is a separate fleet-managed agent; the coding session performing setup is not your conversation.\n")?;
            projects.publish_directory(&staging_name, digest)
        })();
        if result.is_err() {
            std::fs::remove_dir_all(self.root.join("projects").join(&staging_name))
                .map_err(|_| invalid("Failed setup staging requires cleanup"))?;
        }
        result
    }
    pub fn complete(&self, id: &str) -> Result<()> {
        let _gate = self
            .gate
            .lock()
            .map_err(|_| invalid("Setup state ownership failed"))?;
        let mut records = self.read()?;
        if let Some(record) = records
            .iter_mut()
            .find(|record| record.operation_id == id && !record.completed)
        {
            record.completed = true;
            self.save(&records)?;
        }
        Ok(())
    }
    pub fn retry(&self, previous: &str, next: &str) -> Result<()> {
        check::identifier(&json!(next))?;
        let _gate = self
            .gate
            .lock()
            .map_err(|_| invalid("Setup state ownership failed"))?;
        let mut records = self.read()?;
        let record = records
            .iter_mut()
            .find(|record| record.operation_id == previous && !record.completed)
            .ok_or_else(|| {
                Failure::new(
                    ErrorCode::Conflict,
                    "Only an incomplete setup can retry its initial operation",
                )
            })?;
        record.operation_id = next.to_owned();
        self.save(&records)
    }
}
pub fn generated_name(project: &str, identity: &str) -> String {
    let mut prefix = String::new();
    let mut separator = false;
    for character in project.chars().flat_map(char::to_lowercase) {
        if character.is_ascii_lowercase() || character.is_ascii_digit() {
            if separator && !prefix.is_empty() {
                prefix.push('-');
            }
            separator = false;
            prefix.push(character);
        } else {
            separator = true;
        }
    }
    if !prefix.starts_with(|character: char| character.is_ascii_lowercase()) {
        prefix = format!("project-{prefix}");
    }
    prefix.truncate(prefix.len().min(27));
    format!(
        "{}-{}",
        prefix.trim_end_matches('-'),
        &identity[..identity.len().min(12)]
    )
}
