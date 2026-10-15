use std::io::{Result, Write};

pub struct Buffer {
    bytes: Vec<u8>,
    maximum: usize,
}
impl Buffer {
    pub fn new(maximum: usize) -> Self {
        Self {
            bytes: Vec::new(),
            maximum,
        }
    }
    pub fn into_vec(self) -> Vec<u8> {
        self.bytes
    }
}
impl Write for Buffer {
    fn write(&mut self, bytes: &[u8]) -> Result<usize> {
        if bytes.len() > self.maximum - self.bytes.len() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::FileTooLarge,
                "Encoded data exceeds its declared byte bound",
            ));
        }
        self.bytes.extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> Result<()> {
        Ok(())
    }
}
#[derive(Default)]
pub struct Count(pub usize);
impl Write for Count {
    fn write(&mut self, bytes: &[u8]) -> Result<usize> {
        self.0 = self
            .0
            .checked_add(bytes.len())
            .ok_or_else(|| std::io::Error::other("Encoded byte count overflow"))?;
        Ok(bytes.len())
    }
    fn flush(&mut self) -> Result<()> {
        Ok(())
    }
}
