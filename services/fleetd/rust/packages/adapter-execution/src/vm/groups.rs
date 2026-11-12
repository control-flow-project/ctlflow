use super::{
    request::{Request, Selection, invalid},
    resources,
};
use crossfire_adapter_runtime::execution_state;
use crossfire_kernel::Result;
use std::{
    collections::{BTreeSet, VecDeque},
    path::{Path, PathBuf},
    time::{Duration, Instant},
};

fn current() -> Result<PathBuf> {
    Ok(PathBuf::from(format!(
        "/sys/fs/cgroup{}",
        execution_state::current_group()?
    )))
}
pub fn validate(request: &Request, selection: &Selection) -> Result<()> {
    let group = execution_state::current_group()?;
    if !group.ends_with(&format!(
        "/{}/{}",
        resources::slice(&request.fleet)?,
        request.unit()
    )) {
        return Err(invalid(
            "VM supervisor must run in its exact finite fleet user service",
        ));
    }
    let root = current()?;
    let maximum = u64::from(selection.catalog.memory_budget_mib)
        .min(u64::from(selection.profile.maximum_memory_mib) + u64::from(resources::HELPER_MIB))
        * 1048576;
    require(&root, "memory.max", maximum)?;
    require(&root, "memory.swap.max", 0)?;
    require(&root, "pids.max", u64::from(resources::TASKS))?;
    let parent = root
        .parent()
        .ok_or_else(|| invalid("Invalid VM fleet resource group"))?;
    require(
        parent,
        "memory.max",
        u64::from(selection.catalog.memory_budget_mib) * 1048576,
    )?;
    require(parent, "memory.swap.max", 0)?;
    require(parent, "pids.max", u64::from(resources::TASKS))
}
fn require(root: &Path, file: &str, expected: u64) -> Result<()> {
    if std::fs::read_to_string(root.join(file))
        .map_err(|_| invalid("Cannot inspect VM resource containment"))?
        .trim()
        != expected.to_string()
    {
        return Err(invalid(&format!(
            "VM resource containment does not match its configured {file}"
        )));
    }
    Ok(())
}
fn members() -> Result<BTreeSet<u32>> {
    let mut directories = VecDeque::from([current()?]);
    let mut visited = 0;
    let mut members = BTreeSet::new();
    while let Some(directory) = directories.pop_front() {
        visited += 1;
        if visited > resources::TASKS {
            return Err(invalid("VM resource hierarchy exceeds its task bound"));
        }
        for line in std::fs::read_to_string(directory.join("cgroup.procs"))
            .map_err(|_| invalid("Cannot inspect VM process containment"))?
            .lines()
        {
            members.insert(
                line.parse()
                    .map_err(|_| invalid("Invalid VM resource-group process identity"))?,
            );
        }
        for child in std::fs::read_dir(directory)
            .map_err(|_| invalid("Cannot inspect VM subgroup containment"))?
        {
            let child = child.map_err(|_| invalid("Cannot inspect VM resource subgroup"))?;
            if child
                .file_type()
                .map_err(|_| invalid("Cannot inspect VM resource subgroup"))?
                .is_dir()
            {
                directories.push_back(child.path());
            }
        }
    }
    Ok(members)
}
pub fn ready(exports: usize) -> Result<bool> {
    let mut qemu = 0;
    let mut filesystems = 0;
    for pid in members()? {
        match std::fs::read_to_string(format!("/proc/{pid}/comm")) {
            Ok(name) => {
                if name.trim().starts_with("qemu-system") {
                    qemu += 1;
                }
                if name.trim() == "virtiofsd" {
                    filesystems += 1;
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err(invalid("Cannot inspect VM helper process identity")),
        }
    }
    Ok(qemu == 1 && filesystems >= exports)
}
pub async fn closed() -> Result<()> {
    let deadline = Instant::now() + Duration::from_secs(10);
    while members()?.iter().any(|pid| *pid != std::process::id()) {
        if Instant::now() >= deadline {
            return Err(invalid(
                "VM helpers remain alive in their execution group; retain its ownership fence",
            ));
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    Ok(())
}
