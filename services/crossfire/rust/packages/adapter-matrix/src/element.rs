use crossfire_adapter_filesystem::assets::Directory;
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use std::path::Path;
pub struct Element {
    pub directory: Directory,
    pub presentation: serde_json::Value,
}
impl Element {
    pub fn load(element: &Path, host: &str) -> Result<Self> {
        let element = Directory::open(element)?;
        if element.file("index.html", 67108864)?.is_none() {
            return Err(Failure::new(ErrorCode::Missing, "Element index is missing"));
        }
        let presentation = element
            .file(&format!("config.{host}.json"), 65536)?
            .map(|file| {
                let value: serde_json::Value =
                    serde_json::from_slice(&file.read(65536)?).map_err(|_| {
                        Failure::new(
                            ErrorCode::Invalid,
                            "Invalid Element presentation configuration",
                        )
                    })?;
                let Some(object) = value.as_object() else {
                    return Err(Failure::new(
                        ErrorCode::Invalid,
                        "Invalid Element presentation configuration",
                    ));
                };
                let result = object
                    .iter()
                    .filter(|(key, _)| {
                        [
                            "brand",
                            "default_theme",
                            "branding",
                            "embedded_pages",
                            "setting_defaults",
                        ]
                        .contains(&key.as_str())
                    })
                    .map(|(key, value)| (key.clone(), value.clone()))
                    .collect::<serde_json::Map<_, _>>();
                Ok(serde_json::Value::Object(result))
            })
            .transpose()?
            .unwrap_or_else(|| serde_json::json!({}));
        Ok(Self {
            directory: element,
            presentation,
        })
    }
}
