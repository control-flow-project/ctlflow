use crate::tables::{publication, publication_file};
use crossfire_domain::publication::values::*;
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use diesel::prelude::*;

#[derive(Queryable, Selectable, Insertable)]
#[diesel(table_name = publication)]
pub(super) struct Row {
    id: String,
    agent_id: String,
    public_key: String,
    title: String,
    state: String,
    revision: i64,
    created_at: i64,
    expires_at: i64,
    published_at: Option<i64>,
    deleted_at: Option<i64>,
    cleaned_at: Option<i64>,
    total_bytes: i64,
    file_count: i64,
}
impl From<&Publication> for Row {
    fn from(value: &Publication) -> Self {
        Self {
            id: value.id.clone(),
            agent_id: value.agent_id.clone(),
            public_key: value.public_key.clone(),
            title: value.title.clone(),
            state: value.state.as_str().to_owned(),
            revision: value.revision,
            created_at: value.created_at,
            expires_at: value.expires_at,
            published_at: value.published_at,
            deleted_at: value.deleted_at,
            cleaned_at: value.cleaned_at,
            total_bytes: value.total_bytes,
            file_count: value.file_count,
        }
    }
}
impl TryFrom<Row> for Publication {
    type Error = Failure;
    fn try_from(row: Row) -> Result<Self> {
        let state = match row.state.as_str() {
            "staging" => State::Staging,
            "published" => State::Published,
            "deleted" => State::Deleted,
            _ => {
                return Err(Failure::new(
                    ErrorCode::Unavailable,
                    "Invalid stored report state",
                ));
            }
        };
        Ok(Self {
            id: row.id,
            agent_id: row.agent_id,
            public_key: row.public_key,
            title: row.title,
            state,
            revision: row.revision,
            created_at: row.created_at,
            expires_at: row.expires_at,
            published_at: row.published_at,
            deleted_at: row.deleted_at,
            cleaned_at: row.cleaned_at,
            total_bytes: row.total_bytes,
            file_count: row.file_count,
        })
    }
}
#[derive(Queryable, Selectable, Insertable)]
#[diesel(table_name = publication_file)]
pub(super) struct FileRow {
    id: String,
    publication_id: String,
    path: String,
    media_type: String,
    bytes: i64,
    sha256: String,
    uploaded: i64,
}
impl From<&File> for FileRow {
    fn from(value: &File) -> Self {
        Self {
            id: value.id.clone(),
            publication_id: value.publication_id.clone(),
            path: value.manifest.path.clone(),
            media_type: value.manifest.media_type.clone(),
            bytes: value.manifest.bytes,
            sha256: value.manifest.sha256.clone(),
            uploaded: i64::from(value.uploaded),
        }
    }
}
impl TryFrom<FileRow> for File {
    type Error = Failure;
    fn try_from(row: FileRow) -> Result<Self> {
        if ![0, 1].contains(&row.uploaded) {
            return Err(Failure::new(
                ErrorCode::Unavailable,
                "Invalid stored report upload state",
            ));
        }
        Ok(Self {
            id: row.id,
            publication_id: row.publication_id,
            manifest: ManifestFile {
                path: row.path,
                media_type: row.media_type,
                bytes: row.bytes,
                sha256: row.sha256,
            },
            uploaded: row.uploaded == 1,
        })
    }
}
pub(super) fn record(
    (row, agent_name, owner_id, owner_name): (Row, String, String, String),
) -> Result<Record> {
    Ok(Record {
        publication: row.try_into()?,
        agent_name,
        owner_id,
        owner_name,
    })
}
