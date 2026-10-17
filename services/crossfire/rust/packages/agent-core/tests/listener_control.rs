use crossfire_agent_core::listener_control::{Binding, Control};
use crossfire_kernel::secret::Secret;

#[test]
fn delivery_pause_retains_reporting_but_connection_loss_cancels_both()
-> Result<(), Box<dyn std::error::Error>> {
    let binding = Binding {
        fleet_id: "00000000-0000-4000-8000-000000000001".to_owned(),
        connection_id: "00000000-0000-4000-8000-000000000002".to_owned(),
        credential: Secret::new("private".to_owned()),
    };
    let control = Control::new(binding.clone())?;
    assert!(!control.current()?.connected);
    control.update(true, true, None, binding.clone())?;
    let first = control.current()?;
    control.update(true, false, None, binding.clone())?;
    assert!(first.generation.is_cancelled());
    assert!(!first.connection.is_cancelled());
    control.update(true, true, None, binding.clone())?;
    let resumed = control.current()?;
    assert!(!resumed.generation.is_cancelled());
    assert!(!resumed.connection.is_cancelled());
    control.unavailable()?;
    assert!(resumed.generation.is_cancelled());
    assert!(resumed.connection.is_cancelled());
    assert!(control.update(false, true, None, binding.clone()).is_err());
    assert!(!control.current()?.active);
    control.update(true, false, None, binding.clone())?;
    let paused = control.current()?;
    assert!(!paused.connection.is_cancelled());
    let mut replacement = binding;
    replacement.connection_id = "00000000-0000-4000-8000-000000000003".to_owned();
    control.update(true, false, None, replacement)?;
    assert!(paused.connection.is_cancelled());
    Ok(())
}
