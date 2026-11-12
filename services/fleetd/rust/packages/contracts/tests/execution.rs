use fleetd_contracts::execution::{catalog, placement, placement_wire};
use serde_json::{Value, json};

#[test]
fn shared_execution_contract_cases() -> Result<(), Box<dyn std::error::Error>> {
    let cases: Vec<Value> = serde_json::from_str(include_str!(
        "../../../../tests/contracts/execution-cases.json"
    ))?;
    for sample in cases {
        let name = sample["name"].as_str().ok_or("Missing case name")?;
        let expected = sample["valid"]
            .as_bool()
            .ok_or("Missing expected outcome")?;
        let valid = match sample["kind"].as_str() {
            Some("placement") => placement(&sample["value"]).is_ok(),
            Some("catalog") => catalog(&sample["value"]).is_ok(),
            _ => return Err("Unknown execution test category".into()),
        };
        assert_eq!(valid, expected, "Execution case: {name}");
    }
    Ok(())
}

#[test]
fn placement_round_trip_is_exact() -> Result<(), Box<dyn std::error::Error>> {
    for value in [
        json!({"kind":"host"}),
        json!({"kind":"vm","image":"python","profile":"research"}),
    ] {
        let parsed = placement(&value)?;
        assert_eq!(placement_wire(&parsed), value);
    }
    Ok(())
}

#[test]
fn shared_fleet_execution_selection_cases() -> Result<(), Box<dyn std::error::Error>> {
    let cases: Vec<Value> = serde_json::from_str(include_str!(
        "../../../../tests/contracts/execution-selection-cases.json"
    ))?;
    for sample in cases {
        let checked = (|| {
            let roster = fleetd_contracts::configuration::roster(&sample["roster"])?;
            let catalog = (!sample["catalog"].is_null())
                .then(|| catalog(&sample["catalog"]))
                .transpose()?;
            fleetd_contracts::execution::validate(
                roster.instances.iter().map(|instance| &instance.execution),
                catalog.as_ref(),
            )
        })();
        assert_eq!(
            checked.is_ok(),
            sample["valid"]
                .as_bool()
                .ok_or("Missing expected outcome")?,
            "Fleet execution selection: {}",
            sample["name"]
        );
    }
    Ok(())
}
