use crossfire_adapter_filesystem::PrivateDirectory;
use serde::de::DeserializeOwned;
use std::path::Path;
use zeroize::Zeroize;
pub fn private_configuration<T: DeserializeOwned>(
    limit: u64,
) -> Result<T, Box<dyn std::error::Error>> {
    let arguments = std::env::args().skip(1).collect::<Vec<_>>();
    let [file] = arguments.as_slice() else {
        return Err("Provide one private native configuration file".into());
    };
    let path = Path::new(file);
    let directory =
        PrivateDirectory::open(path.parent().ok_or("Missing private directory")?, false)?;
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("Invalid private filename")?;
    let mut bytes = directory.read(name, limit)?;
    let result = serde_json::from_slice(&bytes);
    bytes.zeroize();
    Ok(result?)
}
