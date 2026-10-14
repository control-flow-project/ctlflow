use std::fmt;
use zeroize::Zeroizing;

#[derive(Clone)]
pub struct Secret(Zeroizing<String>);

impl Secret {
    pub fn new(value: String) -> Self {
        Self(Zeroizing::new(value))
    }
    pub fn expose(&self) -> &str {
        self.0.as_str()
    }
}

impl fmt::Debug for Secret {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("[redacted]")
    }
}

impl PartialEq for Secret {
    fn eq(&self, other: &Self) -> bool {
        use subtle::ConstantTimeEq;
        self.expose()
            .as_bytes()
            .ct_eq(other.expose().as_bytes())
            .into()
    }
}

impl Eq for Secret {}
