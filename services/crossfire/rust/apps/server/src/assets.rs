use crossfire_adapter_filesystem::assets::Directory;
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use std::path::Path;
pub struct Assets {
    pub web: Directory,
}
impl Assets {
    pub fn load(web: &Path) -> Result<Self> {
        let web = Directory::open(web)?;
        if web.file("index.html", 67108864)?.is_none() {
            return Err(Failure::new(
                ErrorCode::Missing,
                "Management index is missing",
            ));
        }
        Ok(Self { web })
    }
}
