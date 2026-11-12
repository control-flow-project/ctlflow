use crossfire_adapter_process::NativeCommand;
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use fleetd_domain::execution::{Catalog, Profile};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, path::Path};

pub const HELPER_MIB: u32 = 512;
pub const TASKS: u32 = 1024;
const MIB: u64 = 1_048_576;
#[derive(Clone, Copy)]
pub struct Memory {
    pub total_kib: u64,
    pub available_kib: u64,
}
fn invalid(message: &str) -> Failure {
    Failure::new(ErrorCode::Invalid, message)
}
fn unavailable(message: &str) -> Failure {
    Failure::new(ErrorCode::Unavailable, message)
}
pub fn slice(directory: &Path) -> Result<String> {
    let directory = directory
        .to_str()
        .filter(|path| fleetd_contracts::configuration::absolute_path(path))
        .ok_or_else(|| invalid("Fleet VM budget requires an exact directory"))?;
    Ok(format!(
        "ctlflow-vm-{:x}.slice",
        Sha256::digest(directory.as_bytes())
    ))
}
pub fn parse_memory(text: &str) -> Result<Memory> {
    if text.encode_utf16().count() > 65536 {
        return Err(unavailable("Host memory information exceeds its bound"));
    }
    let mut total = None;
    let mut available = None;
    for line in text.lines() {
        let fields: Vec<_> = line.split_whitespace().collect();
        let destination = match fields.first().copied() {
            Some("MemTotal:") => &mut total,
            Some("MemAvailable:") => &mut available,
            _ => continue,
        };
        if fields.len() != 3
            || fields[2] != "kB"
            || destination.is_some()
            || fields[1].is_empty()
            || !fields[1].bytes().all(|value| value.is_ascii_digit())
        {
            return Err(unavailable("Cannot establish host memory availability"));
        }
        let value = fields[1]
            .parse::<u64>()
            .ok()
            .filter(|value| *value <= i64::MAX as u64 / 1024)
            .ok_or_else(|| unavailable("Cannot establish host memory availability"))?;
        *destination = Some(value);
    }
    match (total, available) {
        (Some(total_kib), Some(available_kib)) if total_kib > 0 && available_kib <= total_kib => {
            Ok(Memory {
                total_kib,
                available_kib,
            })
        }
        _ => Err(unavailable("Cannot establish host memory availability")),
    }
}
pub fn admit(catalog: &Catalog, profile: &Profile, host: Memory) -> Result<()> {
    if !(512..=1048576).contains(&catalog.memory_budget_mib)
        || !(256..=1048576).contains(&catalog.host_reserve_mib)
        || profile.memory_mib < 256
        || profile.maximum_memory_mib < profile.memory_mib
        || profile.maximum_memory_mib > catalog.memory_budget_mib
        || host.total_kib == 0
        || host.available_kib > host.total_kib
    {
        return Err(invalid(
            "Invalid VM resource budget or host memory information",
        ));
    }
    let start = u64::from(profile.memory_mib) + u64::from(HELPER_MIB);
    if (u64::from(catalog.memory_budget_mib) + u64::from(catalog.host_reserve_mib)) * 1024
        > host.total_kib
        || start > u64::from(catalog.memory_budget_mib)
        || (start + u64::from(catalog.host_reserve_mib)) * 1024 > host.available_kib
    {
        return Err(unavailable(
            "VM budget or available host memory cannot retain the configured host reserve",
        ));
    }
    Ok(())
}
pub fn configure(directory: &Path, budget_mib: u32) -> Result<NativeCommand> {
    if !(512..=1048576).contains(&budget_mib) {
        return Err(invalid("Invalid fleet VM memory budget"));
    }
    Ok(NativeCommand {
        binary: "/usr/bin/systemctl".into(),
        arguments: vec![
            "--user".into(),
            "set-property".into(),
            "--runtime".into(),
            slice(directory)?.into(),
            format!("MemoryMax={}", u64::from(budget_mib) * MIB).into(),
            "MemorySwapMax=0".into(),
            format!("TasksMax={TASKS}").into(),
        ],
        workspace: directory.to_owned(),
        environment: BTreeMap::new(),
        input: false,
    })
}
pub fn service(
    directory: &Path,
    id: &str,
    budget_mib: u32,
    profile: &Profile,
    supervisor: &NativeCommand,
) -> Result<NativeCommand> {
    crossfire_contracts::validation::identifier(&serde_json::json!(id))?;
    if !(512..=1048576).contains(&budget_mib)
        || profile.memory_mib < 256
        || profile.maximum_memory_mib < profile.memory_mib
        || profile.maximum_memory_mib > budget_mib
        || u64::from(profile.memory_mib) + u64::from(HELPER_MIB) > u64::from(budget_mib)
    {
        return Err(invalid("Invalid VM execution resource service"));
    }
    let maximum = u64::from(budget_mib)
        .min(u64::from(profile.maximum_memory_mib) + u64::from(HELPER_MIB))
        * MIB;
    let mut arguments = vec![
        "--user".into(),
        "--quiet".into(),
        "--pipe".into(),
        "--wait".into(),
        "--collect".into(),
        "--service-type=exec".into(),
        "--expand-environment=no".into(),
        format!("--unit=ctlflow-execution-{id}").into(),
        format!("--slice={}", slice(directory)?).into(),
        format!("--property=MemoryMax={maximum}").into(),
        "--property=MemorySwapMax=0".into(),
        format!("--property=TasksMax={TASKS}").into(),
        "--property=KillMode=control-group".into(),
        "--property=TimeoutStopSec=15s".into(),
        format!("--working-directory={}", supervisor.workspace.display()).into(),
    ];
    for (key, value) in &supervisor.environment {
        let Some(value) = value.as_ref().and_then(|value| value.to_str()) else {
            return Err(invalid("Invalid VM supervisor environment"));
        };
        if !key.to_str().is_some_and(|key| {
            matches!(
                key,
                "DOTNET_ROOT"
                    | "HOME"
                    | "XDG_CONFIG_HOME"
                    | "XDG_CACHE_HOME"
                    | "CODEX_HOME"
                    | "PI_CODING_AGENT_DIR"
            )
        }) || !fleetd_contracts::configuration::absolute_path(value)
            || value.chars().any(char::is_control)
        {
            return Err(invalid(
                "VM supervisor environment supports only explicit native configuration directories",
            ));
        }
        arguments.push(format!("--setenv={}={value}", key.to_string_lossy()).into());
    }
    arguments.extend(["--".into(), supervisor.binary.clone()]);
    arguments.extend(supervisor.arguments.clone());
    Ok(NativeCommand {
        binary: "/usr/bin/systemd-run".into(),
        arguments,
        workspace: supervisor.workspace.clone(),
        environment: BTreeMap::new(),
        input: supervisor.input,
    })
}
