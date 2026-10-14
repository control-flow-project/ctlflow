use crossfire_domain::publication::port::BinarySource;
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use std::collections::VecDeque;

pub struct Bytes {
    length: i64,
    chunks: VecDeque<Vec<u8>>,
}
impl Bytes {
    pub fn new(chunks: Vec<Vec<u8>>) -> Result<Self> {
        let length = chunks
            .iter()
            .try_fold(0_i64, |total, chunk| {
                total
                    .checked_add(i64::try_from(chunk.len()).ok()?)
                    .filter(|value| *value >= 0)
            })
            .ok_or_else(|| Failure::new(ErrorCode::Limit, "Test input exceeds native length"))?;
        Ok(Self {
            length,
            chunks: chunks.into(),
        })
    }
}
impl BinarySource for Bytes {
    fn length(&self) -> i64 {
        self.length
    }
    async fn next(&mut self) -> Result<Option<Vec<u8>>> {
        Ok(self.chunks.pop_front())
    }
}
