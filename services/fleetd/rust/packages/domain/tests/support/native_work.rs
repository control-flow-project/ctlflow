use super::*;

#[tokio::test]
async fn completed_room_is_cleared_without_erasing_another_room_with_unacknowledged_input()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    for inspect in [true, false] {
        let state = Arc::new(State::default());
        let work = Arc::new(Work::default());
        let owner = Owner::open(
            Arc::new(Adapter(state.clone())),
            input(),
            work.clone(),
            Time(Arc::new(AtomicI64::new(1))),
            Initial::Start,
            CancellationToken::new(),
            Arc::new(crossfire_agent_core::listener_budget::Budget::default()),
        )
        .await?;
        for (context, session, busy) in [
            ("!active:fixture", "active-history", true),
            ("!completed:fixture", "completed-history", false),
        ] {
            state
                .contexts
                .lock()
                .map_err(|_| failed())?
                .push(SavedContext {
                    context: context.into(),
                    session_id: session.into(),
                    runtime: "codex".into(),
                    workspace: PathBuf::from("/fixture"),
                });
            state
                .context_busy
                .lock()
                .map_err(|_| failed())?
                .insert(context.into(), busy);
        }
        let completed = owner
            .runtime()?
            .conversation("!completed:fixture", None)
            .await?;
        completed
            .deliver(
                "Completed room task",
                "completed",
                CancellationToken::new(),
                None,
            )
            .await?;
        completed.acknowledge(&["completed".into()])?;
        let active = owner
            .runtime()?
            .conversation("!active:fixture", None)
            .await?;
        active
            .deliver(
                "Unfinished room task",
                "active",
                CancellationToken::new(),
                None,
            )
            .await?;
        assert_eq!(work.work()?.len(), 2);
        if inspect {
            assert!(owner.runtime()?.inspect().await?);
        } else {
            owner.close().await?;
        }
        assert_eq!(
            work.work()?
                .iter()
                .map(|value| value.context.as_str())
                .collect::<Vec<_>>(),
            vec!["!active:fixture"]
        );
        owner.close().await?;
    }
    Ok(())
}

#[tokio::test]
async fn active_work_is_not_slept_and_explicit_stop_resumes_with_a_checkpointed_reminder()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let state = Arc::new(State::default());
    let clock = Arc::new(AtomicI64::new(1));
    let work = Arc::new(Work::default());
    let owner = Owner::open(
        Arc::new(Adapter(state.clone())),
        input(),
        work.clone(),
        Time(clock.clone()),
        Initial::Start,
        CancellationToken::new(),
        Arc::new(crossfire_agent_core::listener_budget::Budget::default()),
    )
    .await?;
    state.busy.store(true, Ordering::SeqCst);
    for observer in state.observations.lock().map_err(|_| failed())?.clone() {
        observer(ObservationEvent::State {
            runtime: Runtime::Codex,
            session_id: "saved".into(),
            room_id: None,
            state: NativeState::Working,
            observed_at: 1,
            settings: vec![],
            error_message: None,
        });
    }
    clock.store(3600000, Ordering::SeqCst);
    owner.maintain().await?;
    assert_eq!(state.closes.load(Ordering::SeqCst), 0);
    owner.stop_native(true).await?;
    assert_eq!(work.work()?.len(), 1);
    state.busy.store(false, Ordering::SeqCst);
    owner
        .runtime()?
        .deliver("next task", "next", CancellationToken::new(), None)
        .await?;
    {
        let messages = state.deliveries.lock().map_err(|_| failed())?;
        assert_eq!(messages.len(), 2);
        assert!(messages[0].1.contains("re-read the applicable AGENTS.md"));
        assert_eq!(messages[1].0, "next");
    }
    assert_eq!(work.work()?.len(), 1);
    owner.runtime()?.acknowledge(&["next".into()])?;
    assert!(!owner.runtime()?.inspect().await?);
    assert!(work.work()?.is_empty());
    owner.close().await?;
    Ok(())
}
#[tokio::test]
async fn an_idle_native_reader_failure_during_stop_cannot_invent_unfinished_work()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let state = Arc::new(State::default());
    let work = Arc::new(Work::default());
    let owner = Owner::open(
        Arc::new(Adapter(state.clone())),
        input(),
        work.clone(),
        Time(Arc::new(AtomicI64::new(1))),
        Initial::Start,
        CancellationToken::new(),
        Arc::new(crossfire_agent_core::listener_budget::Budget::default()),
    )
    .await?;
    state.inspection_fails.store(true, Ordering::SeqCst);
    owner.stop_native(true).await?;
    assert!(
        work.work()?.is_empty(),
        "Shutdown cannot interpret a cancelled reader as an unfinished model task"
    );
    owner.close().await?;
    assert_eq!(state.closes.load(Ordering::SeqCst), 1);
    assert!(state.deliveries.lock().map_err(|_| failed())?.is_empty());
    Ok(())
}

#[tokio::test]
async fn activation_durably_checkpoints_work_observed_before_native_start_returns()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let state = Arc::new(State::default());
    state.working_on_start.store(true, Ordering::SeqCst);
    let work = Arc::new(Work::default());
    let owner = Owner::open(
        Arc::new(Adapter(state.clone())),
        input(),
        work.clone(),
        Time(Arc::new(AtomicI64::new(1))),
        Initial::Start,
        CancellationToken::new(),
        Arc::new(crossfire_agent_core::listener_budget::Budget::default()),
    )
    .await?;
    let pending = work.work()?;
    assert_eq!(
        pending.len(),
        1,
        "An active turn observed during activation must survive an immediate controller crash"
    );
    assert_eq!(pending[0].context, "shared");
    assert_eq!(pending[0].session_id, "saved");
    state.inspection_fails.store(true, Ordering::SeqCst);
    owner.close().await?;
    assert_eq!(
        work.work()?,
        pending,
        "Shutdown preserves the original correlated continuation without querying a stopped process"
    );
    Ok(())
}

#[tokio::test]
async fn saved_unfinished_work_wakes_during_recovery_without_waiting_for_another_message()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let state = Arc::new(State::default());
    state
        .contexts
        .lock()
        .map_err(|_| failed())?
        .push(SavedContext {
            context: "shared".into(),
            runtime: "codex".into(),
            session_id: "saved".into(),
            workspace: "/fixture".into(),
        });
    let work = Arc::new(Work::default());
    work.save_work(&[ResumeWork {
        context: "shared".into(),
        session_id: "saved".into(),
        message_id: "resume-unfinished".into(),
        checkpointed_at: 1,
    }])?;
    let owner = Owner::open(
        Arc::new(Adapter(state.clone())),
        input(),
        work.clone(),
        Time(Arc::new(AtomicI64::new(2))),
        Initial::ResumeSleeping,
        CancellationToken::new(),
        Arc::new(crossfire_agent_core::listener_budget::Budget::default()),
    )
    .await?;
    assert_eq!(state.starts.load(Ordering::SeqCst), 1);
    assert_eq!(work.work()?.len(), 1);
    assert_ne!(work.work()?[0].message_id, "resume-unfinished");
    assert_eq!(owner.current()?.phase, Phase::Running);
    assert!(
        state
            .deliveries
            .lock()
            .map_err(|_| failed())?
            .iter()
            .any(|(_, text)| text.contains("re-read the applicable AGENTS.md"))
    );
    owner.close().await?;
    Ok(())
}

#[tokio::test]
async fn write_ahead_and_verified_idle_preserve_new_input_against_delayed_notifications_and_queries()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let state = Arc::new(State::default());
    let work = Arc::new(Work::default());
    let owner = Owner::open(
        Arc::new(Adapter(state.clone())),
        input(),
        work.clone(),
        Time(Arc::new(AtomicI64::new(1))),
        Initial::Start,
        CancellationToken::new(),
        Arc::new(crossfire_agent_core::listener_budget::Budget::default()),
    )
    .await?;
    let persisted = work.clone();
    *state.before_delivery.lock().map_err(|_| failed())? = Some(Arc::new(move || {
        let saved = persisted.work()?;
        assert_eq!(
            saved.len(),
            1,
            "Checkpoint must precede native I/O without waiting for a state notification"
        );
        assert_eq!(saved[0].session_id, "saved");
        Ok(())
    }));
    let runtime = owner.runtime()?;
    runtime
        .deliver("First task", "first", CancellationToken::new(), None)
        .await?;
    runtime.acknowledge(&["first".into()])?;
    state.busy.store(true, Ordering::SeqCst);
    for observe in state.observations.lock().map_err(|_| failed())?.clone() {
        observe(ObservationEvent::State {
            runtime: Runtime::Codex,
            session_id: "saved".into(),
            room_id: None,
            state: NativeState::Idle,
            observed_at: 1,
            settings: vec![],
            error_message: None,
        });
    }
    assert!(runtime.inspect().await?);
    assert_eq!(
        work.work()?.len(),
        1,
        "Delayed idle notification cannot delete active native work"
    );
    let entered = Arc::new(tokio::sync::Notify::new());
    let release = Arc::new(tokio::sync::Notify::new());
    *state.inspection_gate.lock().map_err(|_| failed())? = Some((entered.clone(), release.clone()));
    state.busy.store(false, Ordering::SeqCst);
    let inspecting = owner.clone();
    let older = tokio::spawn(async move { inspecting.runtime()?.inspect().await });
    entered.notified().await;
    runtime
        .deliver("Newer task", "newer", CancellationToken::new(), None)
        .await?;
    runtime.acknowledge(&["newer".into()])?;
    release.notify_one();
    older.await??;
    assert_eq!(
        work.work()?.len(),
        1,
        "An older idle query cannot clear a newer submission"
    );
    *state.inspection_gate.lock().map_err(|_| failed())? = None;
    assert!(!runtime.inspect().await?);
    assert!(work.work()?.is_empty());
    owner.close().await?;
    Ok(())
}

#[tokio::test]
async fn failed_write_ahead_prevents_native_submission()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let state = Arc::new(State::default());
    let work = Arc::new(Work::default());
    let owner = Owner::open(
        Arc::new(Adapter(state.clone())),
        input(),
        work.clone(),
        Time(Arc::new(AtomicI64::new(1))),
        Initial::Start,
        CancellationToken::new(),
        Arc::new(crossfire_agent_core::listener_budget::Budget::default()),
    )
    .await?;
    work.reject.store(true, Ordering::SeqCst);
    assert!(
        owner
            .runtime()?
            .deliver("Rejected task", "rejected", CancellationToken::new(), None)
            .await
            .is_err()
    );
    assert!(state.deliveries.lock().map_err(|_| failed())?.is_empty());
    assert!(work.work()?.is_empty());
    work.reject.store(false, Ordering::SeqCst);
    owner.close().await?;
    Ok(())
}
