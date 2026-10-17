use crate::context_state::{self, Binding, REGISTRY, Registry};
use crossfire_adapter_filesystem::{PrivateDirectory, lock::StateLock, owned::OwnedFile};
use crossfire_adapter_runtime::journal;
use crossfire_contracts::validation as check;
use crossfire_kernel::{Failure, Result, failure::ErrorCode, identity};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{BTreeMap, BTreeSet},
    path::Path,
};

const MAXIMUM: u64 = 33554432;
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct File {
    name: String,
    digest: String,
    target: Option<String>,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Plan {
    phase: String,
    registry: Registry,
    files: Vec<File>,
}
pub struct Outcome {
    pub migrated: bool,
    pub contexts: usize,
}
fn invalid(message: &str) -> Failure {
    Failure::new(ErrorCode::Invalid, message)
}
fn targets(registry: &Registry) -> BTreeMap<String, Option<String>> {
    let mut expected = BTreeMap::from([
        ("crossfire-session.json".to_owned(), None),
        ("crossfire-contexts.json".to_owned(), None),
    ]);
    for binding in &registry.bindings {
        let suffix = journal::digest(&binding.context) + ".receipt";
        let source = if binding.context == "shared" {
            "crossfire-session.json.receipt".to_owned()
        } else {
            "crossfire-contexts.json.".to_owned() + &suffix
        };
        for extension in ["", ".instructions"] {
            expected.insert(
                source.clone() + extension,
                Some(format!("{REGISTRY}.{suffix}{extension}")),
            );
            expected.insert(source.clone() + extension + ".lock", None);
        }
    }
    expected
}
fn validate(plan: &Plan, complete: bool) -> Result<()> {
    if !["prepared", "complete"].contains(&plan.phase.as_str())
        || complete && plan.phase != "complete"
        || plan.files.len() > 8010
    {
        return Err(invalid(
            "Native context migration is incomplete or invalid; complete the explicit conversion before resume",
        ));
    }
    plan.registry.validate()?;
    let expected = targets(&plan.registry);
    let mut names = BTreeSet::new();
    let mut outputs = BTreeSet::new();
    for file in &plan.files {
        if file.digest.len() != 64
            || !file
                .digest
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
            || expected.get(&file.name) != Some(&file.target)
            || !names.insert(&file.name)
            || file
                .target
                .as_ref()
                .is_some_and(|target| !outputs.insert(target))
        {
            return Err(invalid(
                "Native conversion contains unexpected files, duplicate evidence or receipt destinations",
            ));
        }
    }
    Ok(())
}
fn manifest(home: &Path) -> Result<Option<Plan>> {
    let file = home.join("crossfire-migrations/context-registry/manifest.json");
    let Some(file) = OwnedFile::open(&file, MAXIMUM)? else {
        return Ok(None);
    };
    file.private_permissions()?;
    let plan: Plan = serde_json::from_slice(&file.configuration(MAXIMUM as usize)?)
        .map_err(|_| invalid("Malformed exact native conversion manifest"))?;
    validate(&plan, false)?;
    Ok(Some(plan))
}
pub(crate) fn validate_completed(home: &Path) -> Result<()> {
    if let Some(plan) = manifest(home)? {
        validate(&plan, true)?;
    }
    Ok(())
}
fn obsolete(directory: &PrivateDirectory) -> Result<Vec<String>> {
    Ok(directory
        .names(20000)?
        .into_iter()
        .filter(|name| context_state::obsolete(name))
        .collect())
}
fn prepare(directory: &PrivateDirectory, home: &Path) -> Result<Option<Plan>> {
    let files = obsolete(directory)?;
    if files.is_empty() {
        return Ok(None);
    }
    if directory.read_optional(REGISTRY, MAXIMUM)?.is_some() {
        return Err(invalid(
            "Canonical and obsolete native contexts coexist without an explicit conversion manifest",
        ));
    }
    let mut registry = Registry {
        mode: "shared".to_owned(),
        bindings: vec![],
    };
    if let Some(bytes) = directory.read_optional("crossfire-contexts.json", MAXIMUM)? {
        let value: Value = serde_json::from_slice(&bytes)
            .map_err(|_| invalid("Invalid previous room contexts"))?;
        let value = check::object(&value, &["mode", "control", "rooms"], &[])?;
        registry.mode = check::choice(&value["mode"], &["shared", "per-room"])?.to_owned();
        if !value["control"].is_null() {
            registry.bindings.push(Binding {
                context: "control".to_owned(),
                session_id: check::identifier(&value["control"])?.to_owned(),
            })
        }
        for room in check::list(&value["rooms"], 0, 2000)? {
            let room = check::object(room, &["room", "sessionId"], &[])?;
            registry.bindings.push(Binding {
                context: check::room_id(&room["room"])?.to_owned(),
                session_id: check::identifier(&room["sessionId"])?.to_owned(),
            });
        }
    }
    if let Some(bytes) = directory.read_optional("crossfire-session.json", MAXIMUM)? {
        let value: Value = serde_json::from_slice(&bytes)
            .map_err(|_| invalid("Invalid previous shared context"))?;
        let value = check::object(&value, &["sessionId"], &[])?;
        registry.bindings.insert(
            0,
            Binding {
                context: "shared".to_owned(),
                session_id: check::identifier(&value["sessionId"])?.to_owned(),
            },
        );
    }
    registry.validate()?;
    let expected = targets(&registry);
    let mut originals = vec![];
    for name in files {
        let target=expected.get(&name).ok_or_else(||invalid("Unrecognized previous native metadata; conversion never guesses or discards it"))?.clone();
        let bytes = directory.read(&name, MAXIMUM)?;
        if target.is_some() {
            let binding = registry
                .bindings
                .iter()
                .find(|binding| {
                    if binding.context == "shared" {
                        name.starts_with("crossfire-session.json.receipt")
                    } else {
                        name.starts_with(&format!(
                            "crossfire-contexts.json.{}.receipt",
                            journal::digest(&binding.context)
                        ))
                    }
                })
                .ok_or_else(|| invalid("Previous native receipt has no exact history binding"))?;
            if name.ends_with(".instructions") {
                journal::read::<crate::instructions::Input>(
                    &home.join(&name),
                    &binding.session_id,
                )?;
            } else {
                journal::read::<crate::input::Input>(&home.join(&name), &binding.session_id)?;
            }
        }
        originals.push(File {
            name,
            digest: identity::hash_bytes(&bytes),
            target,
        });
    }
    let plan = Plan {
        phase: "prepared".to_owned(),
        registry,
        files: originals,
    };
    validate(&plan, false)?;
    Ok(Some(plan))
}
fn write(directory: &PrivateDirectory, plan: &Plan) -> Result<()> {
    directory.write_atomic(
        "manifest.json",
        &serde_json::to_vec_pretty(plan)
            .map_err(|_| invalid("Cannot encode native conversion manifest"))?,
    )
}
pub fn run(workspace: &Path, state: &Path) -> Result<Outcome> {
    crossfire_adapter_filesystem::owned::validate_directory(
        workspace,
        crossfire_adapter_filesystem::owned::DirectoryAccess::Workspace,
    )?;
    PrivateDirectory::open(state, false)?;
    let home = state.join(".codex");
    match std::fs::symlink_metadata(&home) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(Outcome {
                migrated: false,
                contexts: 0,
            });
        }
        Err(_) => {
            return Err(invalid(
                "Cannot inspect native home for explicit context conversion",
            ));
        }
        Ok(_) => {}
    }
    let directory = PrivateDirectory::open(&home, false)?;
    let mut ownership = vec![];
    for name in obsolete(&directory)?
        .iter()
        .filter(|name| name.ends_with(".lock"))
    {
        ownership.push(StateLock::acquire(
            &home.join(name.trim_end_matches(".lock")),
        )?);
    }
    let mut plan = match manifest(&home)? {
        Some(plan) => plan,
        None => match prepare(&directory, &home)? {
            Some(plan) => plan,
            None => {
                return Ok(Outcome {
                    migrated: false,
                    contexts: context_state::load(&home)?.0.bindings.len(),
                });
            }
        },
    };
    if plan.phase == "complete" {
        return Ok(Outcome {
            migrated: false,
            contexts: context_state::load(&home)?.0.bindings.len(),
        });
    }
    let names = plan
        .files
        .iter()
        .map(|file| file.name.as_str())
        .collect::<BTreeSet<_>>();
    if obsolete(&directory)?
        .iter()
        .any(|name| !names.contains(name.as_str()))
    {
        return Err(invalid(
            "Native conversion manifest omits retained original metadata",
        ));
    }
    let manifest =
        PrivateDirectory::open(&home.join("crossfire-migrations/context-registry"), true)?;
    let archive = manifest.child("originals", true)?;
    write(&manifest, &plan)?;
    for file in &plan.files {
        let bytes = match directory.read_optional(&file.name, MAXIMUM)? {
            Some(bytes) => bytes,
            None => archive.read(&file.name, MAXIMUM)?,
        };
        if identity::hash_bytes(&bytes) != file.digest {
            return Err(invalid(
                "Original native evidence changed since conversion preparation",
            ));
        }
        if let Some(saved) = archive.read_optional(&file.name, MAXIMUM)? {
            if identity::hash_bytes(&saved) != file.digest {
                return Err(invalid(
                    "Archived native evidence failed exact-byte verification",
                ));
            }
        } else {
            archive.write_new(&file.name, &bytes)?;
        }
        if let Some(target) = &file.target {
            if let Some(saved) = directory.read_optional(target, MAXIMUM)? {
                if identity::hash_bytes(&saved) != file.digest {
                    return Err(invalid(
                        "Canonical native receipt conflicts with its exact original; no receipt was replaced",
                    ));
                }
            } else {
                directory.write_new(target, &bytes)?;
            }
        }
    }
    if let Some(bytes) = directory.read_optional(REGISTRY, MAXIMUM)? {
        let current: Registry = serde_json::from_slice(&bytes)
            .map_err(|_| invalid("Invalid canonical native registry"))?;
        if serde_json::to_value(&current).ok() != serde_json::to_value(&plan.registry).ok() {
            return Err(invalid(
                "Canonical native histories differ from the verified conversion",
            ));
        }
    }
    context_state::save(&home, &plan.registry)?;
    for file in &plan.files {
        if let Some(bytes) = directory.read_optional(&file.name, MAXIMUM)? {
            if identity::hash_bytes(&bytes) != file.digest {
                return Err(invalid(
                    "Original native evidence changed before retirement",
                ));
            }
            directory.remove(&file.name)?;
        }
    }
    plan.phase = "complete".to_owned();
    write(&manifest, &plan)?;
    let contexts = context_state::load(&home)?.0.bindings.len();
    drop(ownership);
    Ok(Outcome {
        migrated: true,
        contexts,
    })
}
