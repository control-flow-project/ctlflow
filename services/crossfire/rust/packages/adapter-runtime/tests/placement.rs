use crossfire_adapter_process::execution::NativeExecution;
use crossfire_adapter_runtime::{
    ownership,
    placement::{LeaseRequest, NativeLease, NativePlacement},
};
use crossfire_kernel::{Failure, failure::ErrorCode};
use std::{
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};
use tokio::sync::oneshot;
use tokio_util::sync::CancellationToken;

#[tokio::test]
async fn concurrent_close_waits_for_execution_teardown_before_admitting_a_successor()
-> Result<(), Box<dyn std::error::Error>> {
    let root = tempfile::tempdir()?;
    let workspace = root.path().join("workspace");
    let directory = root.path().join("control");
    let home = workspace.join(".codex");
    std::fs::create_dir(&workspace)?;
    let owner = ownership::acquire(&directory, &workspace, &home)?;
    let (entered, ready) = oneshot::channel();
    let (finish, finished) = oneshot::channel();
    let calls = Arc::new(AtomicUsize::new(0));
    let count = Arc::clone(&calls);
    let lease = NativeLease::new(NativeExecution::default(), move || async move {
        count.fetch_add(1, Ordering::SeqCst);
        let _announced = entered.send(());
        finished
            .await
            .map_err(|_| Failure::new(ErrorCode::Native, "Closure fixture disappeared"))?;
        drop(owner);
        Ok(())
    });
    let one = lease.clone();
    let two = lease.clone();
    let first = tokio::spawn(async move { one.close().await });
    let second = tokio::spawn(async move { two.close().await });
    tokio::time::timeout(Duration::from_secs(5), ready).await??;
    assert!(
        !first.is_finished() && !second.is_finished(),
        "Both observers await execution teardown"
    );
    assert!(
        ownership::acquire(&directory, &workspace, &home).is_err(),
        "Pending teardown excludes native successors"
    );
    finish.send(()).map_err(|()| "Close receiver disappeared")?;
    tokio::time::timeout(Duration::from_secs(5), async {
        first.await??;
        second.await??;
        Ok::<_, Box<dyn std::error::Error>>(())
    })
    .await??;
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    let successor = (NativePlacement::default().open)(
        LeaseRequest {
            directory,
            workspace: workspace.clone(),
            state_directory: workspace,
            home,
        },
        CancellationToken::new(),
    )
    .await?;
    successor.close().await?;
    Ok(())
}

#[tokio::test]
async fn execution_cleanup_failure_is_preserved_for_every_close_observer()
-> Result<(), Box<dyn std::error::Error>> {
    let lease = NativeLease::new(NativeExecution::default(), || async {
        Err(Failure::new(
            ErrorCode::Native,
            "Unconfirmed execution closure",
        ))
    });
    for _attempt in 0..2 {
        assert!(
            lease
                .close()
                .await
                .is_err_and(|error| error.message == "Unconfirmed execution closure")
        );
    }
    Ok(())
}

#[tokio::test]
async fn a_live_resource_group_blocks_native_writers_after_the_supervisor_lease_disappears()
-> Result<(), Box<dyn std::error::Error>> {
    use crossfire_adapter_filesystem::{PrivateDirectory, lock::StateLock};
    use crossfire_adapter_runtime::execution_state::{self, ExecutionState};
    let root = tempfile::tempdir()?;
    let workspace = root.path().join("workspace");
    let directory = root.path().join("control");
    let home = workspace.join(".codex");
    PrivateDirectory::open(&workspace, true)?;
    PrivateDirectory::open(&directory, true)?;
    let id = crossfire_kernel::identity::id();
    let group = execution_state::current_group()?;
    {
        let _metadata = StateLock::acquire(&directory.join("owner"))?;
        execution_state::publish(
            &directory,
            &ExecutionState {
                id: id.clone(),
                group: group.clone(),
            },
        )?;
    }
    assert!(
        ownership::acquire(&directory, &workspace, &home).is_err(),
        "Surviving helpers exclude new native writers"
    );
    assert!(
        !home.exists(),
        "Rejected execution cannot prepare native-home files"
    );
    assert!(
        execution_state::remove_closed(&directory, &id).is_err(),
        "Cleanup cannot hide a live resource group"
    );
    let empty = format!(
        "{}/ctlflow-vm-{}.scope",
        std::path::Path::new(&group)
            .parent()
            .and_then(|path| path.to_str())
            .ok_or("Missing group parent")?,
        crossfire_kernel::identity::id().replace('-', "")
    );
    {
        let _metadata = StateLock::acquire(&directory.join("owner"))?;
        execution_state::publish(
            &directory,
            &ExecutionState {
                id: id.clone(),
                group: empty,
            },
        )?;
    }
    assert!(!execution_state::remove_closed(
        &directory,
        &crossfire_kernel::identity::id()
    )?);
    assert!(execution_state::remove_closed(&directory, &id)?);
    let _recovered = ownership::acquire(&directory, &workspace, &home)?;
    Ok(())
}
