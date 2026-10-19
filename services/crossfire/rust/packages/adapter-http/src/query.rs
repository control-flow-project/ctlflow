use crossfire_contracts::{query, validation as check};
use crossfire_domain::read::values::Pagination;
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use serde_json::json;
use std::collections::BTreeMap;
pub struct Query(BTreeMap<String, String>);
impl Query {
    pub fn parse(raw: Option<&str>, allowed: &[&str]) -> Result<Self> {
        let raw = raw.unwrap_or("");
        if raw.len() > 65536 {
            return Err(Failure::new(ErrorCode::Invalid, "Query exceeds its bound"));
        }
        let pairs: Vec<_> = url::form_urlencoded::parse(raw.as_bytes())
            .into_owned()
            .collect();
        query::parameters(&pairs, allowed)?;
        Ok(Self(pairs.into_iter().collect()))
    }
    pub fn get(&self, key: &str) -> Option<&str> {
        self.0.get(key).map(String::as_str)
    }
    pub fn page(&self) -> Result<Pagination> {
        let values = self
            .0
            .iter()
            .map(|(key, value)| (key.as_str(), value.as_str()))
            .collect();
        let (page, size) = query::pagination(&values)?;
        Ok(Pagination { page, size })
    }
    pub fn identifier(&self, key: &str) -> Result<Option<&str>> {
        self.get(key)
            .map(|value| {
                check::identifier(&json!(value))?;
                Ok(value)
            })
            .transpose()
    }
    pub fn search(&self) -> Result<&str> {
        let value = self.get("search").unwrap_or("");
        check::text(&json!(value), 0, 200)?;
        Ok(value)
    }
}
