use crossfire_contracts::{envelope, validation as check};
use crossfire_kernel::failure::ErrorCode;
use serde_json::json;

#[test]
fn native_json_boundaries_match_wire_rules() {
    assert!(check::identifier(&json!("6dbb3849-f039-4267-8d5f-e573f055eb40")).is_ok());
    assert!(check::identifier(&json!("6DBB3849-f039-4267-8d5f-e573f055eb40")).is_err());
    assert!(check::integer(&json!(i64::MIN), i64::MIN, i64::MAX).is_err());
    assert!(check::integer(&json!(check::SAFE_INTEGER + 1), 0, i64::MAX).is_err());
    assert_eq!(check::integer(&json!(1.0), 0, 10).ok(), Some(1));
    assert!(check::integer(&json!(1.5), 0, 10).is_err());
    assert!(check::boolean(&json!("true")).is_err());
    assert!(check::name(&json!("credit-analysis-max")).is_ok());
    assert!(check::name(&json!("_credit")).is_err());
    assert!(check::secret(&json!("A".repeat(43))).is_ok());
    assert!(check::secret(&json!("A".repeat(42))).is_err());
    assert!(check::object(&json!({"known":1,"extra":2}), &["known"], &[]).is_err());
    assert!(check::object(&json!({}), &["known"], &[]).is_err());
}

#[test]
fn unicode_and_plain_text_use_exact_wire_units() {
    assert!(check::text(&json!("🚀"), 1, 1).is_err());
    assert!(check::text(&json!("🚀"), 1, 2).is_ok());
    assert!(check::plain_text(&json!("🚀"), 3).is_err());
    assert!(check::plain_text(&json!("🚀"), 4).is_ok());
    assert!(check::plain_text(&json!("line\nnext\tline"), 100).is_ok());
    assert!(check::plain_text(&json!("bad\u{000b}"), 100).is_err());
    assert!(check::matrix_user_id(&json!("@name:server.test")).is_ok());
    assert!(check::matrix_user_id(&json!("@name\u{feff}:server.test")).is_err());
    assert!(check::matrix_user_id(&json!("@name\u{0085}:server.test")).is_ok());
    assert!(check::room_id(&json!("!opaque:server.test")).is_ok());
    assert!(check::room_id(&json!("#alias:server.test")).is_err());
    assert!(serde_json::from_str::<serde_json::Value>(r#""\ud800""#).is_err());
    assert!(serde_json::from_str::<serde_json::Value>(r#"{"\udfff":true}"#).is_err());
    assert_eq!(check::truncate_utf16("a🚀b", 2), "a");
    assert_eq!(check::truncate_utf16("a🚀b", 3), "a🚀");
    assert_eq!(check::truncate_utf16("🚀", 0), "");
    assert_eq!(check::truncate_utf16("🚀", 1), "");
    assert_eq!(check::truncate_utf16("🚀", 2), "🚀");
}

#[test]
fn error_status_mapping_is_identical() {
    assert_eq!(envelope::http_status(ErrorCode::Limit), 413);
    assert_eq!(envelope::http_status(ErrorCode::Capacity), 409);
    assert_eq!(envelope::http_status(ErrorCode::RateLimit), 429);
    assert_eq!(envelope::http_status(ErrorCode::Unavailable), 503);
}
