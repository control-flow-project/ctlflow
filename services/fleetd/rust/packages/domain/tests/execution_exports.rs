use fleetd_domain::{execution::Mount, execution_exports};
use serde_json::Value;
use std::path::PathBuf;

#[test]
fn host_and_peer_authority_are_never_included_in_guest_exports()
-> Result<(), Box<dyn std::error::Error>> {
    let cases: Vec<Value> = serde_json::from_str(include_str!(
        "../../../../tests/contracts/vm-export-cases.json"
    ))?;
    for sample in cases {
        let path = |key: &str| {
            sample[key]
                .as_str()
                .map(PathBuf::from)
                .ok_or("Missing case path")
        };
        let protected = sample["protected"]
            .as_array()
            .ok_or("Missing protected roots")?
            .iter()
            .map(|value| {
                value
                    .as_str()
                    .map(PathBuf::from)
                    .ok_or("Invalid protected root")
            })
            .collect::<Result<Vec<_>, _>>()?;
        let mounts = sample["additional"]
            .as_array()
            .ok_or("Missing mounts")?
            .iter()
            .map(|value| {
                Ok(Mount {
                    path: value["path"]
                        .as_str()
                        .map(PathBuf::from)
                        .ok_or("Missing source")?,
                    read_only: value["read_only"]
                        .as_bool()
                        .ok_or("Missing readonly selection")?,
                })
            })
            .collect::<Result<Vec<_>, Box<dyn std::error::Error>>>()?;
        let parsed = execution_exports::plan(
            &path("state")?,
            &path("workspace")?,
            &path("control")?,
            &protected,
            &mounts,
        );
        assert_eq!(
            parsed.is_ok(),
            sample["valid"].as_bool().ok_or("Missing expected result")?,
            "VM export policy: {}",
            sample["name"]
        );
        if let Ok(parsed) = parsed {
            for mount in &mounts {
                assert!(
                    parsed.contains(mount),
                    "Exact source and readonly selection retained"
                );
            }
        }
    }
    Ok(())
}
