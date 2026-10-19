use crossfire_adapter_sqlite::store::Store;
use crossfire_contracts::{
    runtime::{DecisionWire, ObservationWire},
    statistics::TokensWire,
    validation,
};
use crossfire_domain::{
    port::UnitOfWork,
    runtime::{
        port::{DecisionRepository, ObservationRepository},
        values::*,
    },
    statistics::*,
};
use crossfire_kernel::identity;
use serde_json::{Value, json};

const NOW: i64 = 1_792_000_000_000;

fn main() -> std::result::Result<(), Box<dyn std::error::Error>> {
    let arguments: Vec<_> = std::env::args().collect();
    if arguments.len() != 6 || !["inspect", "record"].contains(&arguments[1].as_str()) {
        return Err(
            "Expected inspect/record, prepared database, agent UUID, run UUID and decision UUID"
                .into(),
        );
    }
    for id in &arguments[3..] {
        validation::identifier(&json!(id))?;
    }
    let mut store = Store::open(std::path::Path::new(&arguments[2]))?;
    let agent_id = &arguments[3];
    let run_id = &arguments[4];
    let decision_id = &arguments[5];
    if arguments[1] == "record" {
        store.transaction(|store| {
            store.answer(
                decision_id,
                &[Answer {
                    question_id: "question".to_owned(),
                    option_id: Some("yes".to_owned()),
                    text: None,
                }],
            )?;
            store.insert_decision(&Decision {
                summary: DecisionSummary {
                    header: DecisionHeader {
                        id: identity::id(),
                        run_id: run_id.clone(),
                        runtime: Runtime::Codex,
                        session_id: "native-session".to_owned(),
                        request_id: identity::id(),
                        turn_id: "rust-turn".to_owned(),
                        item_id: "rust-item".to_owned(),
                        kind: DecisionKind::Question,
                        action: "input".to_owned(),
                        blocking: true,
                        expires_at: None,
                    },
                    agent_id: agent_id.clone(),
                    status: DecisionStatus::Pending,
                    created_at: NOW + 1,
                },
                review: "Native Rust review 🦉".to_owned(),
                questions: vec![Question {
                    id: "question".to_owned(),
                    title: "Proceed".to_owned(),
                    prompt: "Proceed?".to_owned(),
                    secret: false,
                    allow_text: false,
                    options: vec![OptionChoice {
                        id: "yes".to_owned(),
                        label: "Yes".to_owned(),
                        description: "Proceed".to_owned(),
                    }],
                }],
            })?;
            store.save_observation(
                agent_id,
                &ObservationView {
                    run_id: run_id.clone(),
                    observation: Observation {
                        session_id: "native-session".to_owned(),
                        room_id: None,
                        runtime: Runtime::Codex,
                        state: State::WaitingAnswer,
                        observed_at: NOW + 1,
                        last_activity_at: Some(NOW),
                        history_available: Some(true),
                        history_mode: HistoryMode::Shared,
                        max_input_bytes: INPUT_BYTES,
                        settings: vec![Setting {
                            name: "model".to_owned(),
                            configured: Some("fixture-model".to_owned()),
                            effective: Some("fixture-model".to_owned()),
                        }],
                        error_message: None,
                    },
                },
            )?;
            store.record_statistics(
                agent_id,
                run_id,
                &Batch {
                    sequence: 2,
                    started_at: NOW,
                    ended_at: NOW + 1,
                    dropped: 0,
                    flows: vec![Flow {
                        room_id: "!room:example.test".to_owned(),
                        sender_backend_user_id: "@owner:example.test".to_owned(),
                        message_type: "m.text".to_owned(),
                        totals: Totals {
                            observed: 3,
                            delivered: 3,
                            content_bytes: 200,
                            delivered_bytes: 200,
                            attachment_bytes: 400,
                            largest_bytes: 100,
                        },
                    }],
                    usage: vec![Usage {
                        runtime: "codex".to_owned(),
                        session_id: "native-session".to_owned(),
                        tokens: Tokens {
                            input: 150,
                            cached_input: 60,
                            cache_write_input: None,
                            output: 30,
                            reasoning_output: Some(15),
                            total: 180,
                        },
                    }],
                },
                NOW + 1,
            )
        })?;
    }
    let observations = store
        .observations(agent_id)?
        .iter()
        .map(|value| serde_json::to_value(ObservationWire(value)))
        .collect::<std::result::Result<Vec<_>, _>>()?;
    let decisions = store
        .decisions(agent_id, 1, 100, None)?
        .items
        .into_iter()
        .map(|value| {
            let value = store
                .decision(&value.header.id)?
                .ok_or("Missing decision")?;
            Ok::<_, Box<dyn std::error::Error>>(serde_json::to_value(DecisionWire(&value))?)
        })
        .collect::<std::result::Result<Vec<_>, _>>()?;
    let statistics = store.statistics(std::slice::from_ref(agent_id), 0, 1, 100)?;
    let tokens = statistics
        .tokens
        .as_ref()
        .map(|value| serde_json::to_value(TokensWire(value)))
        .transpose()?
        .unwrap_or(Value::Null);
    println!(
        "{}",
        json!({"observations":observations, "decisions":decisions, "statistics":{"intervals":statistics.intervals,
        "observed":statistics.totals.observed, "contentBytes":statistics.totals.content_bytes, "attachmentBytes":statistics.totals.attachment_bytes,
        "largestBytes":statistics.totals.largest_bytes,"totalFlows":statistics.total_flows,"tokens":tokens}})
    );
    Ok(())
}
