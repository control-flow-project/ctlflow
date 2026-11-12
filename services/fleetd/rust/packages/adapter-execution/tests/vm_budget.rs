use crossfire_adapter_filesystem::PrivateDirectory;
use crossfire_adapter_process::{NativeCommand, NativeProcess, capture};
use fleetd_adapter_execution::vm::{budget, resources};
use fleetd_domain::execution::{Catalog, Network, Profile};
use std::{collections::BTreeMap, time::Duration};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio_util::sync::CancellationToken;

#[tokio::test]
async fn live_fleet_budget_cannot_be_changed_by_another_execution()
-> Result<(), Box<dyn std::error::Error>> {
    let root = tempfile::tempdir()?;
    let fleet = root.path().join("fleet");
    let control = root.path().join("control");
    PrivateDirectory::open(&fleet, true)?;
    PrivateDirectory::open(&control, true)?;
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
    let slice = resources::slice(&fleet)?;
    let first_id = crossfire_kernel::identity::id();
    let second_id = crossfire_kernel::identity::id();
    let mut admission = None;
    let mut process = None;
    let tested: Result<(), Box<dyn std::error::Error>> = async {
        admission = Some(
            budget::open(
                &fleet,
                &control,
                &catalog,
                &profile,
                CancellationToken::new(),
            )
            .await?,
        );
        admission
            .as_ref()
            .ok_or("Missing admission")?
            .reserve(&first_id)?;
        let program = "import sys;print('ready',flush=True);sys.stdin.readline()";
        let scope = resources::service(
            &fleet,
            &first_id,
            catalog.memory_budget_mib,
            &profile,
            &NativeCommand {
                binary: "/usr/bin/python3".into(),
                arguments: vec!["-c".into(), program.into()],
                workspace: fleet.clone(),
                environment: BTreeMap::new(),
                input: true,
            },
        )?;
        process = Some(NativeProcess::start(&scope)?);
        let process = process.as_mut().ok_or("Missing owned fixture process")?;
        let output = process.output()?;
        let mut output = BufReader::new(output);
        let mut ready = String::new();
        tokio::time::timeout(Duration::from_secs(10), output.read_line(&mut ready)).await??;
        if ready != "ready\n" {
            return Err("Fixture failed to become ready".into());
        }
        drop(admission.take());
        let same = budget::open(
            &fleet,
            &control,
            &catalog,
            &profile,
            CancellationToken::new(),
        )
        .await?;
        assert!(
            same.reserve(&second_id).is_err(),
            "Concurrent guest targets must fit the fleet budget"
        );
        drop(same);
        let changed = Catalog {
            memory_budget_mib: 1536,
            ..catalog.clone()
        };
        let different = budget::open(
            &fleet,
            &control,
            &changed,
            &profile,
            CancellationToken::new(),
        )
        .await;
        if !different
            .is_err_and(|error| error.code == crossfire_kernel::failure::ErrorCode::Conflict)
        {
            return Err("A live fleet budget was changed".into());
        }
        let mut input = process.input()?;
        input.write_all(b"close\n").await?;
        input.shutdown().await?;
        drop(input);
        let ended = tokio::time::timeout(Duration::from_secs(10), process.wait()).await??;
        if !ended.success() {
            return Err("The existing execution was interrupted by a budget change".into());
        }
        let changed = budget::open(
            &fleet,
            &control,
            &changed,
            &profile,
            CancellationToken::new(),
        )
        .await?;
        changed.reserve(&second_id)?;
        assert!(
            !control
                .join("targets")
                .join(format!("{first_id}.json"))
                .exists(),
            "Closed guest target is pruned before successor admission"
        );
        let unexpected = control.join("targets/unexpected-directory");
        PrivateDirectory::open(&unexpected, true)?;
        assert!(
            changed.reserve(&crossfire_kernel::identity::id()).is_err(),
            "Fleet accounting must reject unexpected directory entries"
        );
        std::fs::remove_dir(&unexpected)?;
        drop(changed);
        Ok(())
    }
    .await;
    drop(admission);
    let stopped = if let Some(mut process) = process {
        process.stop().await.map(|_| ())
    } else {
        Ok(())
    };
    for operation in ["stop", "revert"] {
        let closed = capture(
            &NativeCommand {
                binary: "/usr/bin/systemctl".into(),
                arguments: vec!["--user".into(), operation.into(), slice.clone().into()],
                workspace: fleet.clone(),
                environment: BTreeMap::new(),
                input: false,
            },
            8192,
            Duration::from_secs(10),
            CancellationToken::new(),
        )
        .await?;
        if !closed.status.success() {
            return Err(format!("Fixture slice cleanup failed: {}", closed.errors).into());
        }
    }
    stopped?;
    tested
}
