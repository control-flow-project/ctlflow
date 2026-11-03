use super::*;

#[tokio::test]
async fn rejected_startup_cleanup_failure_cannot_open_a_competing_native_generation()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let state = saved_state();
    state.wrong_history.store(true, Ordering::SeqCst);
    state.closing_fails.store(true, Ordering::SeqCst);
    let owner = Owner::open(
        Arc::new(Adapter(state.clone())),
        input(),
        Time(Arc::new(AtomicI64::new(1))),
        CancellationToken::new(),
        Arc::new(crossfire_agent_core::listener_budget::Budget::default()),
    )
    .await?;
    for id in ["rejected", "blocked-replacement"] {
        let rejected = owner
            .runtime()?
            .deliver(
                "Must retain exact ownership",
                id,
                CancellationToken::new(),
                None,
            )
            .await;
        assert!(
            rejected.is_err(),
            "Rejected startup cannot accept genuine input"
        );
    }
    assert_eq!(state.starts.load(Ordering::SeqCst), 1);
    assert!(state.deliveries.lock().map_err(|_| failed())?.is_empty());
    assert_eq!(owner.runtime()?.session_id(), "saved");
    state.closing_fails.store(false, Ordering::SeqCst);
    owner.close().await?;
    Ok(())
}

#[tokio::test]
async fn a_hundred_saved_agents_restore_without_native_start_or_model_input()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let states = (0..100).map(|_| saved_state()).collect::<Vec<_>>();
    for restart in 0..3 {
        let mut owners = Vec::new();
        for state in &states {
            let mut request = input();
            request.allow_new_history = false;
            let owner = Owner::open(
                Arc::new(Adapter(state.clone())),
                request,
                Time(Arc::new(AtomicI64::new(1))),
                CancellationToken::new(),
                Arc::new(crossfire_agent_core::listener_budget::Budget::default()),
            )
            .await?;
            assert_eq!(owner.current()?.phase, Phase::Sleeping);
            assert_eq!(owner.runtime()?.session_id(), "saved");
            assert!(!owner.runtime()?.settle(CancellationToken::new()).await?);
            owner.runtime()?.acknowledge(&[])?;
            owner.contexts().await?;
            owner.maintain().await?;
            owners.push(owner);
        }
        if restart == 2 {
            owners[37]
                .runtime()?
                .deliver(
                    "Actual selected input",
                    "selected",
                    CancellationToken::new(),
                    None,
                )
                .await?;
            owners[37].runtime()?.acknowledge(&["selected".into()])?;
        }
        assert_eq!(
            states
                .iter()
                .map(|state| state.starts.load(Ordering::SeqCst))
                .sum::<usize>(),
            usize::from(restart == 2)
        );
        assert_eq!(
            states
                .iter()
                .map(|state| state
                    .deliveries
                    .lock()
                    .map(|values| values.len())
                    .unwrap_or(usize::MAX))
                .sum::<usize>(),
            usize::from(restart == 2)
        );
        for owner in owners {
            owner.close().await?;
        }
    }
    Ok(())
}

#[tokio::test]
async fn an_interrupted_task_does_not_invent_a_restart_prompt()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let state = saved_state();
    for restart in 0..3 {
        let owner = Owner::open(
            Arc::new(Adapter(state.clone())),
            input(),
            Time(Arc::new(AtomicI64::new(1))),
            CancellationToken::new(),
            Arc::new(crossfire_agent_core::listener_budget::Budget::default()),
        )
        .await?;
        assert_eq!(owner.current()?.phase, Phase::Sleeping);
        if restart == 0 {
            owner
                .runtime()?
                .deliver(
                    "Unfinished work",
                    "original",
                    CancellationToken::new(),
                    None,
                )
                .await?;
            owner.runtime()?.acknowledge(&["original".into()])?;
        }
        assert_eq!(state.starts.load(Ordering::SeqCst), 1);
        assert_eq!(state.deliveries.lock().map_err(|_| failed())?.len(), 1);
        owner.close().await?;
    }
    Ok(())
}

#[tokio::test]
async fn a_disconnected_native_generation_waits_for_real_input_and_ignores_retired_observations()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let state = saved_state();
    let clock = Arc::new(AtomicI64::new(1));
    let owner = Owner::open(
        Arc::new(Adapter(state.clone())),
        input(),
        Time(clock.clone()),
        CancellationToken::new(),
        Arc::new(crossfire_agent_core::listener_budget::Budget::default()),
    )
    .await?;
    owner
        .runtime()?
        .deliver("Original input", "original", CancellationToken::new(), None)
        .await?;
    owner.runtime()?.acknowledge(&["original".into()])?;
    let observer = state
        .observations
        .lock()
        .map_err(|_| failed())?
        .first()
        .cloned()
        .ok_or("Native observer")?;
    state
        .native_stop
        .lock()
        .map_err(|_| failed())?
        .as_ref()
        .ok_or("Native lifetime")?
        .cancel();
    owner.maintain().await?;
    for _ in 0..3 {
        owner.maintain().await?;
    }
    assert_eq!(state.starts.load(Ordering::SeqCst), 1);
    assert_eq!(state.closes.load(Ordering::SeqCst), 1);
    assert_eq!(owner.current()?.phase, Phase::Failed);
    owner
        .runtime()?
        .deliver("New actual input", "new", CancellationToken::new(), None)
        .await?;
    let activity = owner.current()?.last_activity_at;
    clock.store(100, Ordering::SeqCst);
    observer(ObservationEvent::State {
        runtime: Runtime::Codex,
        session_id: "saved".into(),
        room_id: None,
        state: NativeState::Working,
        observed_at: 100,
        settings: vec![],
        error_message: None,
    });
    assert_eq!(owner.current()?.last_activity_at, activity);
    assert_eq!(state.starts.load(Ordering::SeqCst), 2);
    assert_eq!(
        state
            .deliveries
            .lock()
            .map_err(|_| failed())?
            .iter()
            .map(|(id, _)| id.as_str())
            .collect::<Vec<_>>(),
        vec!["original", "new"]
    );
    owner.close().await?;
    Ok(())
}
