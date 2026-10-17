use crate::PrivateDirectory;
use crossfire_agent_core::local_state::LocalState;
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use std::path::{Component, Path, PathBuf};

pub struct State {
    root: PathBuf,
}
fn denied() -> Failure {
    Failure::new(
        ErrorCode::Forbidden,
        "Listener state must remain inside its owned private directory",
    )
}
impl State {
    pub fn open(root: &Path, create: bool) -> Result<Self> {
        PrivateDirectory::open(root, create)?;
        Ok(Self {
            root: root.to_owned(),
        })
    }
    fn location(&self, file: &str, create: bool) -> Result<Option<(PrivateDirectory, String)>> {
        let path = Path::new(file);
        let relative = if path.is_absolute() {
            path.strip_prefix(&self.root).map_err(|_| denied())?
        } else {
            path
        };
        if relative.as_os_str().is_empty()
            || relative.as_os_str() != relative.components().collect::<PathBuf>().as_os_str()
        {
            return Err(denied());
        }
        let mut parts = relative.components().peekable();
        let mut directory = PrivateDirectory::open(&self.root, false)?;
        while let Some(component) = parts.next() {
            let Component::Normal(name) = component else {
                return Err(denied());
            };
            let name = name.to_str().ok_or_else(denied)?;
            if parts.peek().is_none() {
                return Ok(Some((directory, name.to_owned())));
            }
            let Some(child) = directory.child_optional(name, create)? else {
                return Ok(None);
            };
            directory = child;
        }
        Err(denied())
    }
}
impl LocalState for State {
    fn read(&self, file: &str, maximum: usize) -> Result<Option<Vec<u8>>> {
        let Some((directory, name)) = self.location(file, false)? else {
            return Ok(None);
        };
        directory.read_optional(&name, maximum as u64)
    }
    fn write(&self, file: &str, bytes: &[u8], maximum: usize) -> Result<()> {
        if bytes.len() > maximum {
            return Err(Failure::new(
                ErrorCode::BodyTooLarge,
                "Listener state exceeds its declared file limit",
            ));
        }
        let (directory, name) = self.location(file, true)?.ok_or_else(denied)?;
        if directory
            .private_file_size(&name)?
            .is_some_and(|size| size > maximum as u64)
        {
            return Err(Failure::new(
                ErrorCode::BodyTooLarge,
                "Existing private state exceeds its declared file limit",
            ));
        }
        directory.write_atomic(&name, bytes)
    }
    fn remove(&self, file: &str) -> Result<()> {
        let Some((directory, name)) = self.location(file, false)? else {
            return Ok(());
        };
        directory.remove_optional(&name)
    }
}
