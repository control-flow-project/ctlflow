pub const MAX_FILES: usize = 512;
pub const MAX_FILE_BYTES: i64 = 8 * 1024 * 1024;
pub const MAX_BUNDLE_BYTES: i64 = 32 * 1024 * 1024;
pub const STAGING_MS: i64 = 3_600_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum State {
    Staging,
    Published,
    Deleted,
}
impl State {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Staging => "staging",
            Self::Published => "published",
            Self::Deleted => "deleted",
        }
    }
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ManifestFile {
    pub path: String,
    pub media_type: String,
    pub bytes: i64,
    pub sha256: String,
}
pub struct Creation {
    pub title: String,
    pub files: Vec<ManifestFile>,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Publication {
    pub id: String,
    pub agent_id: String,
    pub public_key: String,
    pub title: String,
    pub state: State,
    pub revision: i64,
    pub created_at: i64,
    pub expires_at: i64,
    pub published_at: Option<i64>,
    pub deleted_at: Option<i64>,
    pub cleaned_at: Option<i64>,
    pub total_bytes: i64,
    pub file_count: i64,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct File {
    pub id: String,
    pub publication_id: String,
    pub manifest: ManifestFile,
    pub uploaded: bool,
}
#[derive(Debug, Clone)]
pub struct Record {
    pub publication: Publication,
    pub agent_name: String,
    pub owner_id: String,
    pub owner_name: String,
}
#[derive(Debug, Clone)]
pub struct Summary {
    pub id: String,
    pub agent_id: String,
    pub title: String,
    pub state: State,
    pub revision: i64,
    pub created_at: i64,
    pub expires_at: i64,
    pub published_at: Option<i64>,
    pub deleted_at: Option<i64>,
    pub total_bytes: i64,
    pub file_count: i64,
    pub agent_name: String,
    pub owner_id: String,
    pub owner_name: String,
    pub url: Option<String>,
    pub allowed_actions: Vec<&'static str>,
}
pub struct Details {
    pub summary: Summary,
    pub files: Vec<File>,
}
#[derive(Clone)]
pub struct Query {
    pub page: i64,
    pub page_size: i64,
    pub search: String,
    pub state: Option<State>,
    pub agent_id: Option<String>,
    pub owner_id: Option<String>,
}
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct Usage {
    pub instance_bytes: i64,
    pub agent_bytes: i64,
    pub instance_count: i64,
    pub agent_count: i64,
}
#[derive(Clone, Copy)]
pub struct Budget {
    pub instance_bytes: i64,
    pub agent_bytes: i64,
    pub instance_count: i64,
    pub agent_count: i64,
    pub uploads: usize,
}
impl Default for Budget {
    fn default() -> Self {
        Self {
            instance_bytes: 1024 * 1024 * 1024,
            agent_bytes: 128 * 1024 * 1024,
            instance_count: 4096,
            agent_count: 128,
            uploads: 8,
        }
    }
}
