use crossfire_domain::runtime::values::*;

#[test]
fn summaries_keep_all_room_failures_activity_and_honest_unknown_history_state() {
    let values = [
        StateMeasurement {
            state: State::Working,
            observed_at: 100,
            last_activity_at: Some(90),
            history_available: Some(true),
        },
        StateMeasurement {
            state: State::Failed,
            observed_at: 50,
            last_activity_at: Some(40),
            history_available: None,
        },
    ];
    let summary = summarize(values);
    assert!(matches!(
        summary,
        Some(Summary {
            state: SummaryState::Native(State::Failed),
            observed_at: 100,
            last_activity_at: Some(90),
            history_available: None
        })
    ));
    let summary = summarize([
        StateMeasurement {
            state: State::Idle,
            observed_at: 1,
            last_activity_at: None,
            history_available: Some(false),
        },
        values[0],
    ]);
    assert!(summary.is_some_and(|value| value.history_available == Some(false)));
    assert!(summarize(Vec::<StateMeasurement>::new()).is_none());
}
