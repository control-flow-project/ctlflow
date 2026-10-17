use crossfire_adapter_filesystem::{PrivateDirectory, lock::StateLock};
use crossfire_contracts::validation;
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use sha2::{Digest, Sha256};
use std::{path::Path, sync::Arc};

pub const MAXIMUM_BYTES: u64 = 32 * 1024 * 1024;

pub trait NativeMessage: Serialize + DeserializeOwned + Send + Sync {
    fn text(&self) -> &str;
    fn message_id(&self) -> &str;
    fn validate(&self) -> Result<()>;
}

pub fn validate_message(text: &str, message_id: &str) -> Result<()> {
    if text.len() > crossfire_domain::runtime::values::MAX_INPUT_BYTES as usize
        || validation::utf16_length(message_id) > 200
        || message_id.is_empty()
        || message_id
            .chars()
            .any(|character| character <= '\u{1f}' || character == '\u{7f}')
    {
        return Err(Failure::new(
            ErrorCode::Invalid,
            "Invalid native delivery identity or text byte bound",
        ));
    }
    Ok(())
}

pub fn digest(text: &str) -> String {
    format!("{:x}", Sha256::digest(text.as_bytes()))
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Confirmation {
    pub message_id: String,
    pub digest: String,
}

#[derive(Serialize, Deserialize)]
#[serde(
    rename_all = "camelCase",
    deny_unknown_fields,
    bound(deserialize = "T: Deserialize<'de>")
)]
pub struct JournalState<T> {
    pub session_id: String,
    #[serde(deserialize_with = "crossfire_kernel::data::required_option")]
    pub pending: Option<T>,
    pub confirmed: Vec<Confirmation>,
}

pub struct Journal<T> {
    directory: PrivateDirectory,
    name: String,
    ownership: Option<StateLock>,
    state: JournalState<Arc<T>>,
}

fn invalid() -> Failure {
    Failure::new(
        ErrorCode::Invalid,
        "Invalid native delivery journal or session binding",
    )
}
fn conflict() -> Failure {
    Failure::new(
        ErrorCode::Conflict,
        "Native evidence cannot replace its original input identity or content",
    )
}

pub fn read<T: NativeMessage>(path: &Path, session: &str) -> Result<JournalState<T>> {
    validate_message("", session)?;
    let parent = path.parent().ok_or_else(invalid)?;
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(invalid)?;
    let directory = PrivateDirectory::open(parent, false)?;
    let state = match directory.read_optional(name, MAXIMUM_BYTES)? {
        Some(bytes) => serde_json::from_slice::<JournalState<T>>(&bytes).map_err(|_| invalid())?,
        None => JournalState {
            session_id: session.to_owned(),
            pending: None,
            confirmed: Vec::new(),
        },
    };
    if state.session_id != session || state.confirmed.len() > 128 {
        return Err(invalid());
    }
    let mut identities = std::collections::HashSet::new();
    for value in &state.confirmed {
        validate_message("", &value.message_id)?;
        if value.digest.len() != 64
            || !value
                .digest
                .bytes()
                .all(|character| character.is_ascii_digit() || (b'a'..=b'f').contains(&character))
            || !identities.insert(&value.message_id)
        {
            return Err(invalid());
        }
    }
    if let Some(value) = &state.pending {
        validate_message(value.text(), value.message_id())?;
        value.validate()?;
        if identities
            .iter()
            .any(|identity| identity.as_str() == value.message_id())
        {
            return Err(invalid());
        }
    }
    Ok(state)
}

impl<T: NativeMessage> Journal<T> {
    pub fn open(path: &Path, session: &str) -> Result<Self> {
        let ownership = StateLock::acquire(path)?;
        let parsed = read::<T>(path, session)?;
        let state = JournalState {
            session_id: parsed.session_id,
            pending: parsed.pending.map(Arc::new),
            confirmed: parsed.confirmed,
        };
        let directory = PrivateDirectory::open(path.parent().ok_or_else(invalid)?, false)?;
        let name = path
            .file_name()
            .and_then(|value| value.to_str())
            .ok_or_else(invalid)?
            .to_owned();
        Ok(Self {
            directory,
            name,
            ownership: Some(ownership),
            state,
        })
    }

    fn owned(&self) -> Result<()> {
        if self.ownership.is_none() {
            Err(Failure::new(
                ErrorCode::Unavailable,
                "Native delivery journal is closed",
            ))
        } else {
            Ok(())
        }
    }

    pub fn pending(&self) -> Result<Option<Arc<T>>> {
        self.owned()?;
        Ok(self.state.pending.clone())
    }
    pub fn unsettled(&self) -> Result<bool> {
        self.owned()?;
        Ok(self.state.pending.is_some() || !self.state.confirmed.is_empty())
    }
    pub fn close(&mut self) {
        self.ownership.take();
    }

    fn save(&self, pending: Option<&T>, confirmed: &[Confirmation]) -> Result<()> {
        self.owned()?;
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Proposed<'a, T> {
            session_id: &'a str,
            pending: Option<&'a T>,
            confirmed: &'a [Confirmation],
        }
        let bytes = serde_json::to_vec(&Proposed {
            session_id: &self.state.session_id,
            pending,
            confirmed,
        })
        .map_err(|_| invalid())?;
        if bytes.len() as u64 > MAXIMUM_BYTES {
            return Err(invalid());
        }
        self.directory.write_atomic(&self.name, &bytes).map_err(|_| Failure::new(ErrorCode::Unavailable, "Native delivery evidence could not be durably saved; no read position may advance"))
    }

    pub fn confirmed(&self, text: &str, id: &str) -> Result<bool> {
        self.owned()?;
        if let Some(value) = self
            .state
            .confirmed
            .iter()
            .find(|value| value.message_id == id)
        {
            if value.digest != digest(text) {
                return Err(Failure::new(
                    ErrorCode::Conflict,
                    "Native delivery identity was reused with different content",
                ));
            }
            Ok(true)
        } else {
            Ok(false)
        }
    }

    pub fn prepare(&mut self, input: T) -> Result<()> {
        self.owned()?;
        validate_message(input.text(), input.message_id())?;
        input.validate()?;
        if self.state.pending.as_ref().is_some_and(|value| {
            value.text() != input.text() || value.message_id() != input.message_id()
        }) {
            return Err(conflict());
        }
        if self.state.confirmed.len() >= 128
            || self
                .state
                .confirmed
                .iter()
                .any(|value| value.message_id == input.message_id())
        {
            return Err(Failure::new(
                ErrorCode::Conflict,
                "Acknowledge confirmed native deliveries before submitting more input",
            ));
        }
        self.save(Some(&input), &self.state.confirmed)?;
        self.state.pending = Some(Arc::new(input));
        Ok(())
    }

    pub fn complete(&mut self, input: &T, received: bool) -> Result<()> {
        self.owned()?;
        if !self.state.pending.as_ref().is_some_and(|value| {
            value.text() == input.text() && value.message_id() == input.message_id()
        }) {
            return Err(conflict());
        }
        if received {
            let mut confirmed = self
                .state
                .confirmed
                .iter()
                .map(|value| Confirmation {
                    message_id: value.message_id.clone(),
                    digest: value.digest.clone(),
                })
                .collect::<Vec<_>>();
            confirmed.push(Confirmation {
                message_id: input.message_id().to_owned(),
                digest: digest(input.text()),
            });
            self.save(None, &confirmed)?;
            self.state.confirmed = confirmed;
        } else {
            self.save(None, &self.state.confirmed)?;
        }
        self.state.pending = None;
        Ok(())
    }

    pub fn acknowledge(&mut self, identities: &[String]) -> Result<()> {
        self.owned()?;
        let retained = self
            .state
            .confirmed
            .iter()
            .filter(|value| !identities.contains(&value.message_id))
            .map(|value| Confirmation {
                message_id: value.message_id.clone(),
                digest: value.digest.clone(),
            })
            .collect::<Vec<_>>();
        self.save(self.state.pending.as_deref(), &retained)?;
        self.state.confirmed = retained;
        Ok(())
    }
}
