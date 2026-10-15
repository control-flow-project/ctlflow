use crossfire_adapter_filesystem::{PrivateDirectory, assets::Directory, owned::OwnedFile};
use std::os::unix::fs::{PermissionsExt, symlink};

#[test]
fn public_distribution_assets_do_not_inherit_private_configuration_policy()
-> Result<(), Box<dyn std::error::Error>> {
    let root = tempfile::tempdir()?;
    std::fs::set_permissions(root.path(), std::fs::Permissions::from_mode(0o700))?;
    let path = root.path().join("index.html");
    std::fs::write(&path, b"public")?;
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o664))?;
    assert!(
        OwnedFile::open(&path, 100)?
            .ok_or("missing")?
            .configuration(100)
            .is_err()
    );
    let directory = Directory::open(root.path())?;
    assert_eq!(
        directory
            .file("index.html", 100)?
            .ok_or("missing")?
            .read(100)?,
        b"public"
    );
    assert!(directory.file("index.html", 2).is_err());
    for name in [
        "../index.html",
        "./index.html",
        "a//index.html",
        ".private",
        "a\\index.html",
        "index.html\0",
    ] {
        assert!(directory.file(name, 100).is_err());
    }
    symlink(&path, root.path().join("linked.html"))?;
    assert!(directory.file("linked.html", 100).is_err());
    PrivateDirectory::open(root.path(), false)?
        .child("assets", true)?
        .write_new("app.js", b"asset")?;
    assert_eq!(
        directory
            .file("assets/app.js", 100)?
            .ok_or("missing")?
            .read(100)?,
        b"asset"
    );
    Ok(())
}
