use super::resources;
use crossfire_adapter_filesystem::{PrivateDirectory, lock::StateLock};
use crossfire_adapter_process::{NativeCommand, capture};
use crossfire_adapter_runtime::execution_state;
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use fleetd_domain::execution::{Catalog, Profile};
use std::{
    collections::BTreeMap,
    io::Read,
    path::Path,
    time::{Duration, Instant},
};
use tokio_util::sync::CancellationToken;

pub struct BudgetLease {
    _ownership: StateLock,
    directory: std::path::PathBuf,
    group: String,
    maximum_mib: u32,
    target_mib: u32,
}
impl BudgetLease {
    pub fn reserve(&self, id: &str) -> Result<()> {
        use crossfire_adapter_filesystem::owned::OwnedFile;
        use crossfire_contracts::validation as check;
        use serde_json::json;
        check::identifier(&json!(id))?;
        let directory = self.directory.join("targets");
        let private = PrivateDirectory::open(&directory, true)?;
        let files = std::fs::read_dir(&directory)
            .map_err(|_| unavailable("Cannot enumerate fleet VM targets"))?
            .collect::<std::io::Result<Vec<_>>>()
            .map_err(|_| unavailable("Cannot enumerate fleet VM targets"))?;
        if files.len() > 10000 {
            return Err(unavailable("Too many fleet VM target records"));
        }
        let mut used = 0_u64;
        for file in files {
            let source = OwnedFile::open(&file.path(), 4096)?
                .ok_or_else(|| unavailable("Fleet VM target record disappeared"))?;
            source.private_permissions()?;
            let value: serde_json::Value = serde_json::from_slice(&source.configuration(4096)?)
                .map_err(|_| unavailable("Invalid private fleet VM target record"))?;
            let value = check::object(&value, &["id", "targetMiB"], &[])?;
            let identity = check::identifier(&value["id"])?;
            let name = format!("{identity}.json");
            if file.file_name() != std::ffi::OsStr::new(&name) {
                return Err(unavailable("Invalid private fleet VM target filename"));
            }
            let target = check::integer(&value["targetMiB"], 768, 1049088)?;
            let unit = format!("ctlflow-execution-{identity}.service");
            if !self.group.is_empty() && populated(&format!("{}/{}", self.group, unit), &unit)? {
                used += target as u64;
            } else {
                private.remove(&name)?;
            }
        }
        if used + u64::from(self.target_mib) > u64::from(self.maximum_mib) {
            return Err(unavailable(
                "Live guest targets and helper headroom fill this fleet's memory budget",
            ));
        }
        private.write_atomic(
            &format!("{id}.json"),
            &serde_json::to_vec(&json!({"id":id,"targetMiB":self.target_mib}))
                .map_err(|_| unavailable("Cannot encode fleet VM target"))?,
        )
    }
}
pub fn remove(control: &Path, id: &str) -> Result<()> {
    crossfire_contracts::validation::identifier(&serde_json::json!(id))?;
    let _owner = match StateLock::acquire(&control.join("vm-budget")) {
        Ok(owner) => owner,
        Err(error) if error.code == ErrorCode::Conflict => return Ok(()),
        Err(error) => return Err(error),
    };
    PrivateDirectory::open(&control.join("targets"), false)?.remove(&format!("{id}.json"))
}
fn unavailable(message: &str) -> Failure {
    Failure::new(ErrorCode::Unavailable, message)
}
fn populated(group: &str, slice: &str) -> Result<bool> {
    let current = execution_state::current_group()?;
    if current.split('/').count() < 5 {
        return Err(unavailable(
            "Cannot establish current user resource hierarchy",
        ));
    }
    let prefix = current.split('/').take(4).collect::<Vec<_>>().join("/") + "/";
    if !group.starts_with(&prefix)
        || !group.ends_with(&format!("/{slice}"))
        || group.len() > 4096
        || group.split('/').skip(1).any(|part| {
            part.is_empty()
                || part == "."
                || part == ".."
                || !part.chars().all(|value| {
                    value.is_ascii_alphanumeric() || matches!(value, '.' | '-' | '_' | '@')
                })
        })
    {
        return Err(unavailable(
            "Fleet VM budget is outside the current user's resource hierarchy",
        ));
    }
    let file = match std::fs::File::open(format!("/sys/fs/cgroup{group}/cgroup.events")) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(_) => return Err(unavailable("Cannot inspect fleet resource-group state")),
    };
    let mut bytes = Vec::new();
    file.take(4097)
        .read_to_end(&mut bytes)
        .map_err(|_| unavailable("Cannot read fleet resource-group state"))?;
    if bytes.len() > 4096 {
        return Err(unavailable("Fleet resource-group state exceeds its bound"));
    }
    let text = std::str::from_utf8(&bytes)
        .map_err(|_| unavailable("Invalid fleet resource-group state"))?;
    let values: Vec<_> = text
        .lines()
        .filter(|line| line.starts_with("populated "))
        .collect();
    match values.as_slice() {
        ["populated 0"] => Ok(false),
        ["populated 1"] => Ok(true),
        _ => Err(unavailable("Invalid fleet resource-group state")),
    }
}
pub async fn open(
    fleet: &Path,
    control: &Path,
    catalog: &Catalog,
    profile: &Profile,
    cancellation: CancellationToken,
) -> Result<BudgetLease> {
    if !fleet
        .to_str()
        .is_some_and(fleetd_contracts::configuration::absolute_path)
        || !control
            .to_str()
            .is_some_and(fleetd_contracts::configuration::absolute_path)
        || control.starts_with(fleet)
    {
        return Err(Failure::new(
            ErrorCode::Invalid,
            "Fleet VM resource ownership must remain outside the fleet data directory",
        ));
    }
    crossfire_adapter_filesystem::owned::validate_directory(
        fleet,
        crossfire_adapter_filesystem::owned::DirectoryAccess::Workspace,
    )?;
    PrivateDirectory::open(control, false)?;
    let deadline = Instant::now() + Duration::from_secs(30);
    let ownership = loop {
        if cancellation.is_cancelled() {
            return Err(unavailable("Fleet VM resource admission cancelled"));
        }
        match StateLock::acquire(&control.join("vm-budget")) {
            Ok(lease) => break lease,
            Err(error) if error.code == ErrorCode::Conflict => {
                if Instant::now() >= deadline {
                    return Err(unavailable(
                        "Fleet VM resource admission remained busy for thirty seconds",
                    ));
                }
                tokio::select! { biased; _=cancellation.cancelled() => return Err(unavailable("Fleet VM resource admission cancelled")),_=tokio::time::sleep(Duration::from_millis(25))=>{} }
            }
            Err(reason) => return Err(reason),
        }
    };
    let memory = std::fs::read_to_string("/proc/meminfo")
        .map_err(|_| unavailable("Cannot read host memory availability"))?;
    resources::admit(catalog, profile, resources::parse_memory(&memory)?)?;
    let slice = resources::slice(fleet)?;
    let observed = capture(
        &NativeCommand {
            binary: "/usr/bin/systemctl".into(),
            arguments: vec![
                "--user".into(),
                "show".into(),
                "--property=LoadState,ControlGroup,MemoryMax,MemorySwapMax,TasksMax".into(),
                "--".into(),
                slice.clone().into(),
            ],
            workspace: fleet.to_owned(),
            environment: BTreeMap::new(),
            input: false,
        },
        16384,
        Duration::from_secs(10),
        cancellation.clone(),
    )
    .await?;
    if !observed.status.success() {
        return Err(unavailable("Cannot inspect the fleet VM resource budget"));
    }
    let mut fields = BTreeMap::new();
    for line in observed.output.lines().filter(|line| !line.is_empty()) {
        let (key, value) = line
            .split_once('=')
            .ok_or_else(|| unavailable("Invalid user-manager budget metadata"))?;
        if key.is_empty() || fields.insert(key, value).is_some() {
            return Err(unavailable("Invalid user-manager budget metadata"));
        }
    }
    if fields.len() != 5
        || fields.get("LoadState") != Some(&"loaded")
        || ["ControlGroup", "MemoryMax", "MemorySwapMax", "TasksMax"]
            .iter()
            .any(|key| !fields.contains_key(key))
    {
        return Err(unavailable("Incomplete user-manager budget metadata"));
    }
    let same = fields["MemoryMax"] == (u64::from(catalog.memory_budget_mib) * 1048576).to_string()
        && fields["MemorySwapMax"] == "0"
        && fields["TasksMax"] == resources::TASKS.to_string();
    if !fields["ControlGroup"].is_empty() && populated(fields["ControlGroup"], &slice)? && !same {
        return Err(Failure::new(
            ErrorCode::Conflict,
            "Stop this fleet's VM executions before changing its populated resource budget",
        ));
    }
    if !same {
        let configured = capture(
            &resources::configure(fleet, catalog.memory_budget_mib)?,
            8192,
            Duration::from_secs(10),
            cancellation,
        )
        .await?;
        if !configured.status.success() {
            return Err(unavailable("Cannot configure the fleet VM resource budget"));
        }
    }
    Ok(BudgetLease {
        _ownership: ownership,
        directory: control.to_owned(),
        group: fields["ControlGroup"].to_owned(),
        maximum_mib: catalog.memory_budget_mib,
        target_mib: profile.memory_mib + resources::HELPER_MIB,
    })
}
