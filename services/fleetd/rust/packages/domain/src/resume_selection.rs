use crate::model::{Instance, Registration, ResumeSelection};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use std::collections::{BTreeMap, BTreeSet};

pub trait SelectionStore {
    fn resume_selections(&self) -> Result<Vec<ResumeSelection>>;
    fn save_resume_selections(&self, values: &[ResumeSelection]) -> Result<()>;
}
pub struct Selections<'a, Storage> {
    store: &'a Storage,
    saved: BTreeMap<String, Vec<String>>,
}
impl<'a, Storage: SelectionStore> Selections<'a, Storage> {
    pub fn load(store: &'a Storage, records: &[Registration]) -> Result<Self> {
        let values = store.resume_selections()?;
        if values.iter().any(|value| {
            !records
                .iter()
                .any(|record| record.fleet_id == value.fleet_id)
        }) {
            return Err(Failure::new(
                ErrorCode::Invalid,
                "Saved resume selection references an unregistered fleet",
            ));
        }
        Ok(Self {
            store,
            saved: values
                .into_iter()
                .map(|value| (value.fleet_id, value.instance_keys))
                .collect(),
        })
    }
    pub fn view(&self, fleet_id: &str) -> Option<Vec<String>> {
        self.saved.get(fleet_id).cloned()
    }
    fn persist(&mut self, next: BTreeMap<String, Vec<String>>) -> Result<()> {
        let values: Vec<_> = next
            .iter()
            .map(|(fleet_id, keys)| ResumeSelection {
                fleet_id: fleet_id.clone(),
                instance_keys: keys.clone(),
            })
            .collect();
        self.store.save_resume_selections(&values)?;
        self.saved = next;
        Ok(())
    }
    pub fn select(
        &self,
        fleet_id: &str,
        catalog: &[Instance],
        enabled: &[String],
    ) -> Result<Vec<Instance>> {
        let paused = self.saved.get(fleet_id);
        if paused.is_none() && enabled.is_empty() {
            return Ok(catalog.to_vec());
        }
        let keys: BTreeSet<_> = paused.into_iter().flatten().chain(enabled).collect();
        if keys
            .iter()
            .any(|key| !catalog.iter().any(|instance| &instance.key == *key))
        {
            return Err(Failure::new(
                ErrorCode::Conflict,
                "A saved resume target is missing from the current roster; review the fleet",
            ));
        }
        Ok(catalog
            .iter()
            .filter(|instance| keys.contains(&instance.key))
            .cloned()
            .collect())
    }
    pub fn stop(
        &mut self,
        fleet_id: &str,
        enabled: &[String],
        instance_key: Option<&str>,
    ) -> Result<()> {
        let previous = self.saved.get(fleet_id);
        if instance_key.is_none() && enabled.is_empty() && previous.is_some() {
            return Ok(());
        }
        let mut next = self.saved.clone();
        let values: Vec<_> = match instance_key {
            None => {
                let mut values = enabled.to_vec();
                values.sort_unstable();
                values
            }
            Some(key) => previous
                .into_iter()
                .flatten()
                .chain(enabled)
                .filter(|value| value.as_str() != key)
                .cloned()
                .collect::<BTreeSet<_>>()
                .into_iter()
                .collect(),
        };
        next.insert(fleet_id.to_owned(), values);
        self.persist(next)
    }
    pub fn forget(&mut self, fleet_id: &str, instance_key: Option<&str>) -> Result<()> {
        if !self.saved.contains_key(fleet_id) {
            return Ok(());
        }
        let mut next = self.saved.clone();
        if let Some(key) = instance_key {
            if let Some(values) = next.get_mut(fleet_id) {
                values.retain(|value| value != key);
            }
        } else {
            next.remove(fleet_id);
        }
        self.persist(next)
    }
}
