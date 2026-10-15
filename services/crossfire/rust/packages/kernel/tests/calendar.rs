use crossfire_kernel::time::{MAX_TIMESTAMP, iso_timestamp, parse_iso_timestamp};
#[test]
fn canonical_calendar_roundtrips_native_extremes_and_rejects_ambiguous_or_impossible_dates()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    for timestamp in [
        -MAX_TIMESTAMP,
        -62167219200000,
        -2208988800123,
        -1,
        0,
        1,
        946684800001,
        253402300799999,
        MAX_TIMESTAMP,
    ] {
        assert_eq!(parse_iso_timestamp(&iso_timestamp(timestamp)?)?, timestamp);
    }
    for text in [
        "2026-02-30T00:00:00.000Z",
        "2026-10-15T24:00:00.000Z",
        "2026-10-15T12:60:00.000Z",
        "2026-10-15T12:00:00Z",
        "2026-10-15T12:00:00.000+00:00",
        "2026-10-15T-1:00:00.000Z",
        "1970-01-01T00:00:00.0-1Z",
    ] {
        assert!(parse_iso_timestamp(text).is_err(), "{text}");
    }
    Ok(())
}
