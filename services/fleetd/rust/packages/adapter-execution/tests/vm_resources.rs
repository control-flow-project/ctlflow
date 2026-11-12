use crossfire_adapter_process::{NativeCommand, capture};
use fleetd_adapter_execution::vm::resources::{self, Memory};
use fleetd_domain::execution::{Catalog, Network, Profile};
use std::{collections::BTreeMap, path::Path, time::Duration};
use tokio_util::sync::CancellationToken;

fn command(root: &Path, binary: &str, arguments: Vec<std::ffi::OsString>) -> NativeCommand {
    NativeCommand {
        binary: binary.into(),
        arguments,
        workspace: root.to_owned(),
        environment: BTreeMap::new(),
        input: false,
    }
}
#[tokio::test]
async fn actual_user_service_charges_all_processes_to_a_finite_fleet_budget()
-> Result<(), Box<dyn std::error::Error>> {
    let memory = resources::parse_memory(
        "MemTotal: 8388608 kB\nMemFree: 123 kB\nMemAvailable: 4194304 kB\n",
    )?;
    assert_eq!((memory.total_kib, memory.available_kib), (8388608, 4194304));
    for invalid in [
        "MemTotal: 1 kB\nMemAvailable: 2 kB\n",
        "MemTotal: 8 kB\nMemTotal: 8 kB\nMemAvailable: 2 kB\n",
        "MemTotal: 8388608 MB\nMemAvailable: 2 kB\n",
    ] {
        assert!(resources::parse_memory(invalid).is_err());
    }
    let profile = Profile {
        cpus: 1,
        memory_mib: 256,
        maximum_memory_mib: 256,
        network: Network::Disabled,
        mounts: vec![],
    };
    let catalog = Catalog {
        memory_budget_mib: 1024,
        host_reserve_mib: 256,
        images: BTreeMap::new(),
        profiles: BTreeMap::new(),
    };
    resources::admit(&catalog, &profile, memory)?;
    assert!(
        resources::admit(
            &catalog,
            &profile,
            Memory {
                total_kib: 8388608,
                available_kib: 1000000
            }
        )
        .is_err()
    );
    assert!(
        resources::admit(
            &Catalog {
                memory_budget_mib: 8192,
                ..catalog.clone()
            },
            &profile,
            memory
        )
        .is_err()
    );
    let root = tempfile::tempdir()?;
    let root = root.path();
    let slice = resources::slice(root)?;
    let id = crossfire_kernel::identity::id();
    let program = "import json,pathlib; p=pathlib.Path('/sys/fs/cgroup'+pathlib.Path('/proc/self/cgroup').read_text().strip()[3:]); print(json.dumps({'group':str(p),'memory':(p/'memory.max').read_text().strip(),'swap':(p/'memory.swap.max').read_text().strip(),'tasks':(p/'pids.max').read_text().strip(),'fleetMemory':(p.parent/'memory.max').read_text().strip(),'fleetTasks':(p.parent/'pids.max').read_text().strip()}))";
    let scoped = resources::service(
        root,
        &id,
        catalog.memory_budget_mib,
        &profile,
        &command(root, "/usr/bin/python3", vec!["-c".into(), program.into()]),
    )?;
    let tested: Result<serde_json::Value, Box<dyn std::error::Error>> = async {
        let configured = capture(
            &resources::configure(root, catalog.memory_budget_mib)?,
            8192,
            Duration::from_secs(10),
            CancellationToken::new(),
        )
        .await?;
        if !configured.status.success() {
            return Err(
                format!("Actual fixture slice configuration: {}", configured.errors).into(),
            );
        }
        let output = capture(
            &scoped,
            16384,
            Duration::from_secs(10),
            CancellationToken::new(),
        )
        .await?;
        if !output.status.success() {
            return Err(format!("Actual fixture service: {}", output.errors).into());
        }
        Ok(serde_json::from_str(&output.output)?)
    }
    .await;
    for operation in ["stop", "revert"] {
        let closed = capture(
            &command(
                root,
                "/usr/bin/systemctl",
                vec!["--user".into(), operation.into(), slice.clone().into()],
            ),
            8192,
            Duration::from_secs(10),
            CancellationToken::new(),
        )
        .await?;
        assert!(
            closed.status.success(),
            "Only the isolated fixture slice is {operation}ed: {}",
            closed.errors
        );
    }
    let value = tested?;
    assert_eq!(value["memory"].as_str(), Some("805306368"));
    assert_eq!(value["swap"].as_str(), Some("0"));
    assert_eq!(value["tasks"].as_str(), Some("1024"));
    assert_eq!(value["fleetMemory"].as_str(), Some("1073741824"));
    assert_eq!(value["fleetTasks"].as_str(), Some("1024"));
    assert!(
        value["group"].as_str().is_some_and(
            |value| value.ends_with(&format!("{slice}/ctlflow-execution-{id}.service"))
        )
    );
    Ok(())
}
