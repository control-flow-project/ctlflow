use crossfire_kernel::bytes::{Buffer, Count};
use std::io::Write;

#[test]
fn native_byte_buffers_stop_before_exceeding_the_declared_capacity()
-> Result<(), Box<dyn std::error::Error>> {
    let mut buffer = Buffer::new(4);
    buffer.write_all(b"ab")?;
    let error = buffer.write_all(b"cde").err().ok_or("oversize must fail")?;
    assert_eq!(error.kind(), std::io::ErrorKind::FileTooLarge);
    buffer.write_all(b"cd")?;
    assert_eq!(buffer.into_vec(), b"abcd");
    let mut count = Count::default();
    count.write_all(b"one")?;
    count.write_all(b"two")?;
    assert_eq!(count.0, 6);
    let mut count = Count(usize::MAX);
    assert!(count.write_all(b"overflow").is_err());
    Ok(())
}
