use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;

use crate::{Failure, Result, failure::ErrorCode};

pub fn id() -> String {
    uuid::Uuid::new_v4().to_string()
}

pub fn random_bytes<const SIZE: usize>() -> Result<[u8; SIZE]> {
    let mut bytes = [0_u8; SIZE];
    let mut position = 0;
    while position < SIZE {
        match rustix::rand::getrandom(
            &mut bytes[position..],
            rustix::rand::GetRandomFlags::empty(),
        ) {
            Ok(0) => {
                return Err(Failure::new(
                    ErrorCode::Unavailable,
                    "Secure entropy unavailable",
                ));
            }
            Ok(count) => position += count,
            Err(rustix::io::Errno::INTR) => continue,
            Err(_) => {
                return Err(Failure::new(
                    ErrorCode::Unavailable,
                    "Secure entropy unavailable",
                ));
            }
        }
    }
    Ok(bytes)
}

pub fn secret() -> Result<crate::secret::Secret> {
    Ok(crate::secret::Secret::new(
        URL_SAFE_NO_PAD.encode(random_bytes::<32>()?),
    ))
}

pub fn hash(value: &str) -> String {
    hash_bytes(value.as_bytes())
}
pub fn hash_bytes(value: &[u8]) -> String {
    format!("{:x}", Sha256::digest(value))
}

pub fn matches(value: &str, digest: &str) -> bool {
    let actual = hash(value);
    actual.as_bytes().ct_eq(digest.as_bytes()).into()
}

pub fn now() -> Result<i64> {
    let elapsed = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| Failure::new(ErrorCode::Unavailable, "Invalid system clock"))?;
    i64::try_from(elapsed.as_millis())
        .map_err(|_| Failure::new(ErrorCode::Unavailable, "System clock exceeds native range"))
}
