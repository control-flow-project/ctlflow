use crate::{
    operations::{self, Operation, OperationId},
    validation,
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};

pub trait Key: Copy + Send + Sync + 'static + Sized {
    fn definition(self) -> Result<&'static Operation<Self>>;
    fn validate_parameter(self, name: &str, value: &Value) -> Result<()>;
    fn query_fields(self) -> &'static [&'static str];
}
impl Key for OperationId {
    fn definition(self) -> Result<&'static Operation<Self>> {
        operations::operations()
            .find(|operation| operation.id == self)
            .ok_or_else(|| Failure::new(ErrorCode::Invalid, "Operation is not declared"))
    }
    fn validate_parameter(self, name: &str, value: &Value) -> Result<()> {
        match name {
            "roomId" => {
                validation::room_id(value)?;
            }
            "eventId" => {
                validation::event_id(value)?;
            }
            _ => {
                validation::identifier(value)?;
            }
        }
        Ok(())
    }
    fn query_fields(self) -> &'static [&'static str] {
        crate::query::operations::fields(self)
    }
}
pub struct Call<Id = OperationId> {
    pub operation: Id,
    pub parameters: BTreeMap<String, String>,
    pub query: BTreeMap<String, String>,
    pub body: Option<Value>,
}
impl<Id: Key> Call<Id> {
    pub fn new(operation: Id) -> Self {
        Self {
            operation,
            parameters: BTreeMap::new(),
            query: BTreeMap::new(),
            body: None,
        }
    }
    pub fn definition(&self) -> Result<&'static Operation<Id>> {
        self.operation.definition()
    }
    pub fn path_parts(&self) -> Result<Vec<String>> {
        let definition = self.definition()?;
        let mut used = BTreeSet::new();
        let parts = definition
            .path
            .split('/')
            .map(|part| {
                let Some(key) = part
                    .strip_prefix('{')
                    .and_then(|part| part.strip_suffix('}'))
                else {
                    return Ok(part.to_owned());
                };
                let value = self.parameters.get(key).ok_or_else(|| {
                    Failure::new(ErrorCode::Invalid, "Missing operation path parameter").field(key)
                })?;
                self.operation.validate_parameter(key, &json!(value))?;
                used.insert(key);
                Ok(value.clone())
            })
            .collect::<Result<Vec<_>>>()?;
        if self
            .parameters
            .keys()
            .any(|key| !used.contains(key.as_str()))
        {
            return Err(Failure::new(
                ErrorCode::Invalid,
                "Unknown operation path parameter",
            ));
        }
        let queries = self
            .query
            .iter()
            .map(|(key, value)| (key.clone(), value.clone()))
            .collect::<Vec<_>>();
        crate::query::parameters(&queries, self.operation.query_fields())?;
        Ok(parts)
    }
}
impl Call<OperationId> {
    pub fn agent(operation: OperationId, agent: &str) -> Self {
        let mut call = Self::new(operation);
        call.parameters
            .insert("agentId".to_owned(), agent.to_owned());
        call
    }
}
