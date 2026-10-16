use crossfire_server::{container_commands as commands, container_lifecycle as lifecycle};

#[test]
fn runtime_and_migration_names_labels_and_cleanup_have_one_owner()
-> Result<(), Box<dyn std::error::Error>> {
    let directory = "/private/instance";
    let [runtime, migration] = lifecycle::names(directory);
    let suffix = &crossfire_kernel::identity::hash(directory)[..16];
    assert_eq!(runtime, format!("crossfire-{suffix}"));
    assert_eq!(migration, format!("crossfire-migration-{suffix}"));
    let resources = commands::resources(Some("verification.slice"))?;
    let migration = commands::migration(directory, "migration:image", &resources);
    let server = commands::server(directory, "runtime:image", &runtime, 8080, 8082, &resources);
    for arguments in [&migration, &server] {
        assert!(
            arguments
                .windows(2)
                .any(|pair| pair == ["--label", "org.crossfire.directory=/private/instance"])
        );
        assert!(
            arguments
                .windows(2)
                .any(|pair| pair == ["--cgroup-parent", "verification.slice"])
        );
        assert!(
            !arguments
                .iter()
                .any(|value| value == "--rm" || value.starts_with("--rm="))
        );
    }
    assert!(migration.contains(&"none".to_owned()));
    assert!(server.contains(&"127.0.0.1:8080:8080".to_owned()));
    assert!(server.contains(&"127.0.0.1:8082:8082".to_owned()));
    Ok(())
}
