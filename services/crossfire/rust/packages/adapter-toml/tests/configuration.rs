use crossfire_adapter_toml::{format, parse};

#[test]
fn native_toml_preserves_tables_arrays_strings_and_native_integers()
-> Result<(), Box<dyn std::error::Error>> {
    let table = parse("model = 'native'\nvalue = 9223372036854775807\n[profile]\neffort = 'high'\nlabels = ['one', 'two']\nquoted = '😀'\n".as_bytes())?;
    assert_eq!(table["value"].as_integer(), Some(i64::MAX));
    assert_eq!(table["profile"]["quoted"].as_str(), Some("😀"));
    let restored = parse(format(&table)?.as_bytes())?;
    assert_eq!(restored, table);
    assert!(parse(b"value = 1\nvalue = 2\n").is_err());
    assert!(parse(&[255]).is_err());
    assert!(parse(&vec![b'x'; 1024 * 1024 + 1]).is_err());
    Ok(())
}
