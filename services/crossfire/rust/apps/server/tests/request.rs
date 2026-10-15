use crossfire_adapter_http::server::{Method, Request};
use crossfire_contracts::operations::OperationId;
use crossfire_kernel::failure::ErrorCode;
use crossfire_server::request::{self, Query};

#[test]
fn well_formed_forbidden_paths_are_missing_without_weakening_encoding_checks()
-> Result<(), Box<dyn std::error::Error>> {
    for target in [
        "/manage/assets/%2e%2e%2fpackage.json",
        "/manage/../bootstrap.json",
        "/%2e/private",
    ] {
        let input = Request::builder().uri(target).body(())?;
        assert_eq!(
            request::path(&input).err().map(|error| error.code),
            Some(ErrorCode::Missing)
        );
    }
    for target in [
        "/api/rooms/%",
        "/api/rooms/%ff",
        "/api/rooms/%00",
        "/api/rooms/%5c",
    ] {
        let input = Request::builder().uri(target).body(())?;
        assert_eq!(
            request::path(&input).err().map(|error| error.code),
            Some(ErrorCode::Invalid)
        );
    }
    Ok(())
}

#[tokio::test]
async fn unsafe_or_missing_public_assets_are_not_disclosed()
-> Result<(), Box<dyn std::error::Error>> {
    use crossfire_adapter_filesystem::assets::Directory;
    use crossfire_server::assets;
    use tokio_util::sync::CancellationToken;
    let root = tempfile::tempdir()?;
    std::fs::write(root.path().join("index.html"), b"public")?;
    std::os::unix::fs::symlink(
        root.path().join("index.html"),
        root.path().join("linked.html"),
    )?;
    let directory = Directory::open(root.path())?;
    for path in ["/../private", "/.private", "/linked.html", "/missing.json"] {
        assert_eq!(
            assets::serve(&directory, path, false, CancellationToken::new())
                .err()
                .map(|error| error.code),
            Some(ErrorCode::Missing)
        );
    }
    assert_eq!(
        assets::serve(&directory, "/", false, CancellationToken::new())?
            .status()
            .as_u16(),
        200
    );
    Ok(())
}

#[test]
fn routes_accept_only_current_declared_resources_and_unambiguous_queries()
-> Result<(), Box<dyn std::error::Error>> {
    let selected = request::select(&Method::GET, "/api/sessions/current")?;
    assert_eq!(selected.operation.id, OperationId::CurrentSession);
    assert_eq!(
        request::select(&Method::POST, "/api/sessions/current")
            .err()
            .map(|error| error.code),
        Some(ErrorCode::MethodNotAllowed)
    );
    assert_eq!(
        request::select(&Method::GET, "/api/sessions/obsolete")
            .err()
            .map(|error| error.code),
        Some(ErrorCode::Missing)
    );
    let selected = request::select(&Method::GET, "/api/rooms/%21room%3Aexample.test")?;
    assert_eq!(selected.parameter("roomId")?, "!room:example.test");
    for path in [
        "/api/rooms/%",
        "/api/rooms/%ff",
        "/api/rooms/%00",
        "/api/rooms/%5c",
        "/api/agents/agent",
        "/api/agents/00000000-0000-0000-0000-00000000000g",
    ] {
        assert!(
            request::select(&Method::GET, path)
                .and_then(|selection| selection.validate())
                .is_err(),
            "reject malformed target"
        );
    }
    for target in [
        "http://evil.example/api/health",
        "//evil.example/api/health",
        "/api/../health",
        "/api/rooms/%00",
    ] {
        let input = Request::builder().uri(target).body(())?;
        assert!(
            request::path(&input).is_err(),
            "reject ambiguous request target"
        );
    }
    let query = Query::parse(
        Some("page=2&pageSize=0x20&search=x%2By"),
        &["page", "pageSize", "search"],
    )?;
    assert_eq!(query.page()?.page, 2);
    assert_eq!(query.page()?.size, 32);
    assert_eq!(query.search()?, "x+y");
    assert!(Query::parse(Some("page=1&page=2"), &["page"]).is_err());
    assert!(Query::parse(Some("alias=true"), &[]).is_err());
    assert!(Query::parse(Some("page=NaN"), &["page"])?.page().is_err());
    Ok(())
}
