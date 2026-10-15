use crossfire_agent_core::synchronization::{CancellationToken, StartupScope};

#[tokio::test]
async fn startup_cancellation_is_linked_until_ownership_transfer_but_not_afterwards()
-> Result<(), Box<dyn std::error::Error>> {
    let lifetime = CancellationToken::new();
    let caller = CancellationToken::new();
    let mut startup = StartupScope::new(&lifetime, Some(&caller));
    let native = startup.cancellation.clone();
    startup.transfer(Some(&caller)).await?;
    drop(startup);
    caller.cancel();
    assert!(
        !native.is_cancelled(),
        "Completing input admission never terminates a running native session"
    );
    lifetime.cancel();
    assert!(
        native.is_cancelled(),
        "The controller lifetime still owns the process"
    );
    Ok(())
}
#[tokio::test]
async fn cancelled_or_abandoned_startup_never_retains_a_native_lifetime() {
    let lifetime = CancellationToken::new();
    let caller = CancellationToken::new();
    let mut startup = StartupScope::new(&lifetime, Some(&caller));
    caller.cancel();
    assert!(startup.transfer(Some(&caller)).await.is_err());
    assert!(startup.cancellation.is_cancelled());
    let abandoned = StartupScope::new(&lifetime, None);
    let token = abandoned.cancellation.clone();
    drop(abandoned);
    assert!(token.is_cancelled());
    assert!(
        !lifetime.is_cancelled(),
        "Retiring one startup never cancels unrelated agents"
    );
}
