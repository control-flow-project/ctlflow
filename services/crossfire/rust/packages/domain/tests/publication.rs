use crossfire_domain::publication::{validation, values::*};
fn creation() -> Creation {
    Creation {
        title: "Report".to_owned(),
        files: vec![ManifestFile {
            path: "index.html".to_owned(),
            media_type: "text/html".to_owned(),
            bytes: 0,
            sha256: "0".repeat(64),
        }],
    }
}
#[test]
fn manifest_rejects_traversal_case_aliases_file_directory_conflicts_and_excess_capacity()
-> Result<(), Box<dyn std::error::Error>> {
    for path in [
        "../index.html",
        "/index.html",
        "a//index.html",
        "a/../index.html",
        "a\\index.html",
        "a./index.html",
        ".hidden.html",
        "näme.html",
        "index.HTML",
        "a/index.html/",
    ] {
        let mut input = creation();
        input.files[0].path = path.to_owned();
        assert!(
            validation::manifest(&input).is_err(),
            "Rejected path {path}"
        );
    }
    let mut input = creation();
    input.files.push(input.files[0].clone());
    input.files[1].path = "INDEX.html".to_owned();
    assert!(validation::manifest(&input).is_err());
    input.files[1].path = "index.html/file.js".to_owned();
    input.files[1].media_type = "text/javascript".to_owned();
    assert!(validation::manifest(&input).is_err());
    let mut input = creation();
    input.files[0].bytes = MAX_FILE_BYTES + 1;
    assert!(validation::manifest(&input).is_err());
    let mut input = creation();
    input.files[0].sha256 = "Z".repeat(64);
    assert!(validation::manifest(&input).is_err());
    let mut input = creation();
    input.title = "😀".repeat(100);
    assert_eq!(validation::manifest(&input)?, 0);
    input.title.push('x');
    assert!(validation::manifest(&input).is_err());
    Ok(())
}
