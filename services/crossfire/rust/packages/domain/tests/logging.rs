use crossfire_domain::logging::*;
use crossfire_kernel::{Failure, Result, failure::ErrorCode};

struct Recorder {
    calls: Vec<(i64, Option<Cursor>, Option<Cursor>)>,
    fail: bool,
}

impl LoggingRepository for Recorder {
    fn prune_logging(&mut self, input: &PruneInput<'_>) -> Result<PruneResult> {
        self.calls
            .push((input.cutoff, input.runs.cloned(), input.operations.cloned()));
        if self.fail {
            return Err(Failure::new(ErrorCode::Unavailable, "Unavailable"));
        }
        Ok(PruneResult {
            removed: 1,
            more: true,
            runs: Some(Cursor {
                at: 1,
                id: "run".to_owned(),
            }),
            operations: Some(Cursor {
                at: 2,
                id: "operation".to_owned(),
            }),
        })
    }
}

#[test]
fn retention_has_one_exact_week_default_and_validates_its_native_resource_bounds() -> Result<()> {
    assert_eq!(Retention::new(None)?.days(), 7);
    assert_eq!(Retention::new(Some(14))?.days(), 14);
    for value in [0, -1, i64::MAX, 9_007_199_254_740_991] {
        assert!(Retention::new(Some(value)).is_err());
    }
    let mut retention = Retention::new(None)?;
    let mut recorder = Recorder {
        calls: Vec::new(),
        fail: false,
    };
    assert!(retention.maintain(&mut recorder, 10 * DAY_MS, 0).is_err());
    assert!(
        retention
            .maintain(&mut recorder, 10 * DAY_MS, 1001)
            .is_err()
    );
    assert!(recorder.calls.is_empty());
    retention.maintain(&mut recorder, 10 * DAY_MS, 500)?;
    assert_eq!(recorder.calls[0].0, 3 * DAY_MS);
    Ok(())
}

#[test]
fn keyset_cursors_advance_only_after_success_and_reset_when_the_clock_moves_backwards() -> Result<()>
{
    let mut retention = Retention::new(None)?;
    let mut recorder = Recorder {
        calls: Vec::new(),
        fail: false,
    };
    retention.maintain(&mut recorder, 10 * DAY_MS, 1)?;
    recorder.fail = true;
    assert!(retention.maintain(&mut recorder, 11 * DAY_MS, 1).is_err());
    recorder.fail = false;
    retention.maintain(&mut recorder, 11 * DAY_MS, 1)?;
    assert!(recorder.calls[1].1 == recorder.calls[2].1);
    retention.maintain(&mut recorder, 9 * DAY_MS, 1)?;
    assert!(recorder.calls[3].1.is_none());
    assert!(recorder.calls[3].2.is_none());
    Ok(())
}
