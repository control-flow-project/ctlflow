use crossfire_adapter_filesystem::PrivateDirectory;
use std::{
    fs,
    os::unix::fs::{PermissionsExt, symlink},
};

#[test]
fn private_files_are_atomic_owned_and_bounded() -> Result<(), Box<dyn std::error::Error>> {
    let fixture = tempfile::tempdir()?;
    let path = fixture.path().join("private");
    let directory = PrivateDirectory::open(&path, true)?;
    assert_eq!(fs::metadata(&path)?.permissions().mode() & 0o777, 0o700);
    directory.write_atomic("state.json", b"first")?;
    directory.write_atomic("state.json", b"second")?;
    assert_eq!(directory.read("state.json", 6)?, b"second");
    assert!(directory.read("state.json", 5).is_err());
    assert_eq!(
        fs::metadata(path.join("state.json"))?.permissions().mode() & 0o777,
        0o600
    );
    assert!(directory.read("../state.json", 100).is_err());
    assert!(directory.write_atomic("a/b", b"no").is_err());
    Ok(())
}

#[test]
fn symlinks_and_public_permissions_are_rejected() -> Result<(), Box<dyn std::error::Error>> {
    let fixture = tempfile::tempdir()?;
    let path = fixture.path().join("private");
    let directory = PrivateDirectory::open(&path, true)?;
    let external = fixture.path().join("external");
    fs::write(&external, b"untouched")?;
    symlink(&external, path.join("link"))?;
    assert!(directory.read("link", 100).is_err());
    assert!(directory.prepared_database("link").is_err());
    rustix::fs::mknodat(
        rustix::fs::CWD,
        path.join("fifo"),
        rustix::fs::FileType::Fifo,
        rustix::fs::Mode::from_raw_mode(0o600),
        0,
    )?;
    assert!(
        directory.read("fifo", 100).is_err(),
        "Native private-state reads must reject FIFOs without waiting for a writer"
    );
    directory.write_atomic("link", b"replacement")?;
    assert_eq!(fs::read(&external)?, b"untouched");
    let linked_directory = fixture.path().join("linked");
    symlink(&path, &linked_directory)?;
    assert!(PrivateDirectory::open(&linked_directory, false).is_err());
    let lexical_alias = std::path::PathBuf::from(format!("{}/./private", fixture.path().display()));
    assert!(
        PrivateDirectory::open(&lexical_alias, false).is_err(),
        "Exact private paths reject lexical aliases"
    );
    fs::set_permissions(&path, fs::Permissions::from_mode(0o755))?;
    assert!(PrivateDirectory::open(&path, false).is_err());
    Ok(())
}
