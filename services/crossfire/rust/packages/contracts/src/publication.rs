use crate::{query, validation as check};
use crossfire_domain::publication::values::*;
use crossfire_kernel::Result;
use serde_json::{Value, json};

pub fn state(value: &Value) -> Result<State> {
    Ok(
        match check::choice(value, &["staging", "published", "deleted"])? {
            "staging" => State::Staging,
            "published" => State::Published,
            _ => State::Deleted,
        },
    )
}
pub fn creation(value: &Value) -> Result<Creation> {
    let value = check::object(value, &["title", "files"], &[])?;
    let files = check::list(&value["files"], 1, MAX_FILES)?
        .iter()
        .map(|value| {
            let value = check::object(value, &["path", "mediaType", "bytes", "sha256"], &[])?;
            let sha = check::text(&value["sha256"], 64, 64)?;
            if !sha
                .bytes()
                .all(|character| character.is_ascii_digit() || (b'a'..=b'f').contains(&character))
            {
                return Err(crossfire_kernel::Failure::new(
                    crossfire_kernel::failure::ErrorCode::Invalid,
                    "Expected SHA-256 hex",
                ));
            }
            Ok(ManifestFile {
                path: check::text(&value["path"], 1, 240)?.to_owned(),
                media_type: check::text(&value["mediaType"], 1, 100)?.to_owned(),
                bytes: check::integer(&value["bytes"], 0, MAX_FILE_BYTES)?,
                sha256: sha.to_owned(),
            })
        })
        .collect::<Result<_>>()?;
    Ok(Creation {
        title: check::text(&value["title"], 1, 200)?.to_owned(),
        files,
    })
}
pub fn mutation(value: &Value) -> Result<i64> {
    let value = check::object(value, &["expectedRevision"], &[])?;
    check::integer(&value["expectedRevision"], 0, check::SAFE_INTEGER)
}
pub fn query(input: &[(String, String)]) -> Result<Query> {
    let input = query::parameters(
        input,
        &["page", "pageSize", "ownerId", "agentId", "search", "state"],
    )?;
    let (page, page_size) = query::pagination(&input)?;
    let identifier = |value: &&str| check::identifier(&json!(value)).map(str::to_owned);
    Ok(Query {
        page,
        page_size,
        search: check::text(&json!(input.get("search").copied().unwrap_or("")), 0, 200)?.to_owned(),
        owner_id: input.get("ownerId").map(identifier).transpose()?,
        agent_id: input.get("agentId").map(identifier).transpose()?,
        state: input
            .get("state")
            .map(|value| state(&json!(value)))
            .transpose()?,
    })
}
pub fn summary(value: &Summary) -> Value {
    json!({ "id": value.id, "agentId": value.agent_id, "agentName": value.agent_name, "ownerId": value.owner_id, "ownerName": value.owner_name,
        "title": value.title, "state": value.state.as_str(), "revision": value.revision, "createdAt": value.created_at, "expiresAt": value.expires_at,
        "publishedAt": value.published_at, "deletedAt": value.deleted_at, "totalBytes": value.total_bytes, "fileCount": value.file_count,
        "url": value.url, "allowedActions": value.allowed_actions })
}
pub fn details(value: &Details) -> Value {
    let mut result = summary(&value.summary);
    result["files"] = Value::Array(value.files.iter().map(|file| json!({ "id": file.id, "path": file.manifest.path,
        "mediaType": file.manifest.media_type, "bytes": file.manifest.bytes, "sha256": file.manifest.sha256, "uploaded": file.uploaded })).collect());
    result
}
