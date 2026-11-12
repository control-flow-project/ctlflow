use fleetd_storage::{authentication, ownership};
use serde::Deserialize;
use std::path::Path;

#[derive(Deserialize)]
struct Case {
    state: String,
    key: String,
}

#[test]
fn host_ownership_derivation_matches_every_native_target() -> Result<(), Box<dyn std::error::Error>>
{
    let cases: Vec<Case> = serde_json::from_str(include_str!(
        "../../../../tests/contracts/native-ownership-cases.json"
    ))?;
    for sample in cases {
        assert_eq!(
            ownership::directory(Path::new(&sample.state))?,
            authentication::root()?
                .join("ctlflow/native-ownership")
                .join(sample.key),
            "Both targets derive the same host ownership identity"
        );
    }
    for state in [
        "relative",
        "/fleet/../other",
        "/fleet/./other",
        "/fleet//other",
        "/fleet/",
        "/fleet\\other",
        "/fleet\0other",
    ] {
        assert!(
            ownership::directory(Path::new(state)).is_err(),
            "Ownership derivation rejects a noncanonical state path"
        );
    }
    Ok(())
}
