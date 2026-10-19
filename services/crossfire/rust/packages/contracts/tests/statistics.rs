use crossfire_contracts::statistics::{self, BatchWire};
use crossfire_kernel::identity;
use serde_json::{Value, json};

fn sample() -> Value {
    json!({"sequence":1, "startedAt":1, "endedAt":2, "dropped":0,
        "flows":[{"roomId":"!room:example.test", "senderBackendUserId":"@sender:example.test", "messageType":"m.text", "observed":2, "delivered":1, "contentBytes":100, "deliveredBytes":40, "attachmentBytes":0, "largestBytes":60}],
        "usage":[{"runtime":"codex", "sessionId":"session-🦉", "tokens":{"input":100, "cachedInput":40, "cacheWriteInput":null, "output":20, "reasoningOutput":5, "total":120}}]})
}

#[test]
fn statistics_digest_matches_the_real_node_contract_including_unicode_and_nulls()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let input = sample();
    let parsed = statistics::batch(&input)?;
    let content = serde_json::to_string(&BatchWire(&parsed))?;
    assert_eq!(
        identity::hash(&content),
        "e2e63aa63db66abecb6ec45d508ed145ed62e5b91f515782887aa2d492d57e20"
    );
    assert!(serde_json::from_str::<Value>(&content)? == input);
    Ok(())
}

#[test]
fn statistics_validation_rejects_duplicate_summaries_invalid_token_subsets_and_resource_overflow()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let mut input = sample();
    let items = input["flows"].as_array_mut().ok_or("Missing flow list")?;
    items.push(items[0].clone());
    assert!(statistics::batch(&input).is_err());
    let mut input = sample();
    let items = input["usage"].as_array_mut().ok_or("Missing usage list")?;
    items.push(items[0].clone());
    assert!(statistics::batch(&input).is_err());
    let mut input = sample();
    input["usage"][0]["tokens"]["cachedInput"] = json!(101);
    assert!(statistics::batch(&input).is_err());
    let mut input = sample();
    input["usage"][0]["tokens"]["reasoningOutput"] = json!(21);
    assert!(statistics::batch(&input).is_err());
    let mut input = sample();
    input["endedAt"] = json!(0);
    assert!(statistics::batch(&input).is_err());
    let mut input = sample();
    input["sequence"] = json!(0);
    assert!(statistics::batch(&input).is_err());
    let mut input = sample();
    input["flows"][0]["observed"] = json!(9_007_199_254_740_992_i64);
    assert!(statistics::batch(&input).is_err());
    let mut input = sample();
    input["usage"][0]["tokens"]["unknown"] = json!(0);
    assert!(statistics::batch(&input).is_err());
    let mut input = sample();
    input["usage"] = Value::Array(vec![input["usage"][0].clone(); 33]);
    assert!(statistics::batch(&input).is_err());
    Ok(())
}
