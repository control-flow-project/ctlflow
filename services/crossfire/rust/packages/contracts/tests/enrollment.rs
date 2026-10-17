use crossfire_contracts::enrollment::Digest;
use crossfire_domain::{
    coordination::{MatrixSender, Policy},
    enrollment::values::{Controller, Entry, Roster},
};
use std::collections::BTreeMap;
#[test]
fn native_enrollment_collation_and_json_bytes_match_the_current_node_contract()
-> Result<(), Box<dyn std::error::Error>> {
    let digest = Digest::new()?;
    let values = [
        "@a:example.test",
        "@a-b:example.test",
        "@a0:example.test",
        "@aa:example.test",
        "@A:example.test",
        "@ä:example.test",
        "@é:example.test",
        "@e\u{301}:example.test",
        "@Å:example.test",
        "@😀:example.test",
        "@人:example.test",
        "@a_b:example.test",
        "@a.b:example.test",
        "@ss:example.test",
        "@ß:example.test",
        "@أ:example.test",
        "@क:example.test",
    ];
    let output = std::process::Command::new("node").args(["--input-type=module","-e","const values=JSON.parse(process.argv[1]);process.stdout.write(JSON.stringify(values.flatMap(left=>values.map(right=>Math.sign(left.localeCompare(right))))));",&serde_json::to_string(&values)?]).output()?;
    assert!(output.status.success());
    let expected = serde_json::from_slice::<Vec<i32>>(&output.stdout)?;
    let actual = values
        .iter()
        .flat_map(|left| {
            values
                .iter()
                .map(|right| match digest.compare(left, right) {
                    std::cmp::Ordering::Less => -1,
                    std::cmp::Ordering::Equal => 0,
                    std::cmp::Ordering::Greater => 1,
                })
        })
        .collect::<Vec<_>>();
    assert_eq!(actual, expected);
    let roster = Roster {
        owner_matrix_id: "@owner:example.test".to_owned(),
        fleet_key: "fleet".to_owned(),
        controller: Controller {
            name: "Owner \"controller\" 😀".to_owned(),
            metadata: BTreeMap::from([
                ("zz".to_owned(), "second".to_owned()),
                ("aa".to_owned(), "first".to_owned()),
            ]),
        },
        controller_credential: None,
        instances: vec![Entry {
            instance_key: "worker".to_owned(),
            name: "worker-high".to_owned(),
            identity: None,
            policy: Policy {
                mode: crossfire_domain::identity::WakeMode::Selected,
                senders: values
                    .iter()
                    .rev()
                    .map(|value| MatrixSender {
                        matrix_user_id: (*value).to_owned(),
                        include_agents: false,
                    })
                    .collect(),
                invite_agents: true,
            },
        }],
    };
    let value = digest.value(&roster)?;
    let output = std::process::Command::new("node").args(["--input-type=module","-e","const v=JSON.parse(process.argv[1]);v.controller.metadata.sort(([a],[b])=>a.localeCompare(b));for(const item of v.items)item[3].senders.sort((a,b)=>a.matrixUserId.localeCompare(b.matrixUserId));v.items.sort((a,b)=>a[0].localeCompare(b[0]));process.stdout.write(JSON.stringify(v));",&value]).output()?;
    assert!(output.status.success());
    assert_eq!(value, String::from_utf8(output.stdout)?);
    Ok(())
}
#[test]
fn enrollment_wire_boundaries_reject_unknown_aliases_duplicate_sources_and_invalid_claims()
-> Result<(), Box<dyn std::error::Error>> {
    use crossfire_contracts::enrollment;
    use serde_json::json;
    let value = json!({"controller":{"name":"Controller","metadata":{"label":"owned"}},"ownerMatrixId":"@owner:example.test","fleetKey":"fleet",
        "instances":[{"instanceKey":"worker","name":"worker-high","coordinationPolicy":{"wakeMode":"selected","senders":[{"matrixUserId":"@owner:example.test","includeAgents":true}],"permissions":["room.agent.invite"]}}]});
    let parsed = enrollment::roster(&value)?;
    assert!(parsed.instances[0].policy.invite_agents);
    assert!(parsed.instances[0].policy.senders[0].include_agents);
    let mut unknown = value.clone();
    unknown["runtime"] = json!("codex");
    assert!(enrollment::roster(&unknown).is_err());
    let mut duplicate = value.clone();
    duplicate["instances"][0]["coordinationPolicy"]["senders"] = json!([{"matrixUserId":"@owner:example.test","includeAgents":true},{"matrixUserId":"@owner:example.test","includeAgents":false}]);
    assert!(enrollment::roster(&duplicate).is_err());
    let mut everyone = value.clone();
    everyone["instances"][0]["coordinationPolicy"]["wakeMode"] = json!("everyone");
    assert!(enrollment::roster(&everyone).is_err());
    let mut invalid = value.clone();
    invalid["controller"]["metadata"]["not a key"] = json!("wrong");
    assert!(enrollment::roster(&invalid).is_err());
    invalid = value.clone();
    invalid["instances"][0]["identity"] = json!({"agentId":"invalid","accessToken":"secret"});
    assert!(enrollment::roster(&invalid).is_err());
    invalid = value.clone();
    invalid["enrollmentId"] = json!(crossfire_kernel::identity::id());
    invalid["claimSecret"] = json!(crossfire_kernel::identity::secret()?.expose());
    let introduction = enrollment::introduction(&invalid)?;
    assert_eq!(introduction.roster.instances[0].name, "worker-high");
    invalid["claimSecret"] = json!("invalid");
    assert!(enrollment::introduction(&invalid).is_err());
    assert!(enrollment::decision(&json!({"expectedRevision":0,"decision":"approve","verificationCode":"123456ABCDEF","confirm":true})).is_err());
    assert!(enrollment::claim(&json!({"claimSecret":"invalid"})).is_err());
    Ok(())
}
