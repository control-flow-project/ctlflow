use crossfire_contracts::{publication, query};
use serde_json::json;
#[test]
fn publication_boundaries_reject_unknown_fields_duplicates_and_invalid_filters()
-> Result<(), Box<dyn std::error::Error>> {
    let value = json!({"title":"Report", "files":[{"path":"index.html","mediaType":"text/html","bytes":0,"sha256":"0".repeat(64)}]});
    assert_eq!(publication::creation(&value)?.files.len(), 1);
    let mut bad = value.clone();
    bad["unknown"] = json!(true);
    assert!(publication::creation(&bad).is_err());
    bad = value.clone();
    bad["files"][0]["uploaded"] = json!(true);
    assert!(publication::creation(&bad).is_err());
    assert!(
        publication::query(&[
            ("page".to_owned(), "1".to_owned()),
            ("page".to_owned(), "2".to_owned())
        ])
        .is_err()
    );
    assert!(publication::query(&[("ownerId".to_owned(), "not-an-id".to_owned())]).is_err());
    assert!(publication::query(&[("search".to_owned(), "x".repeat(201))]).is_err());
    assert_eq!(publication::query(&[])?.page_size, 20);
    Ok(())
}
#[test]
fn pagination_preserves_the_canonical_numeric_wire_contract()
-> Result<(), Box<dyn std::error::Error>> {
    for (value, expected) in [
        ("1e2", 100),
        ("0x10", 16),
        ("+2", 2),
        ("2.0", 2),
        ("\u{feff}2\u{feff}", 2),
        ("0002", 2),
    ] {
        let input = vec![("page".to_owned(), value.to_owned())];
        assert_eq!(
            query::pagination(&query::parameters(&input, &["page"])?)?.0,
            expected
        );
    }
    for value in [
        "", "-1", "1.5", "Infinity", "nan", "+0x2", "100001", "0x", "abc",
    ] {
        let input = vec![("page".to_owned(), value.to_owned())];
        assert!(
            query::pagination(&query::parameters(&input, &["page"])?).is_err(),
            "Rejected numeric query {value}"
        );
    }
    Ok(())
}
