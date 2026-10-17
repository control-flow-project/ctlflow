use crossfire_kernel::time::{MAX_TIMESTAMP, iso_timestamp};
#[test]
fn iso_timestamp_preserves_exact_native_milliseconds_and_the_entire_shared_calendar_range()
-> Result<(), Box<dyn std::error::Error>> {
    for (time, expected) in [
        (0, "1970-01-01T00:00:00.000Z"),
        (-1, "1969-12-31T23:59:59.999Z"),
        (MAX_TIMESTAMP, "+275760-09-13T00:00:00.000Z"),
        (-MAX_TIMESTAMP, "-271821-04-20T00:00:00.000Z"),
        (951_782_400_123, "2000-02-29T00:00:00.123Z"),
        (-62_167_219_200_000, "0000-01-01T00:00:00.000Z"),
    ] {
        assert_eq!(iso_timestamp(time)?, expected);
    }
    assert!(iso_timestamp(MAX_TIMESTAMP + 1).is_err());
    Ok(())
}
