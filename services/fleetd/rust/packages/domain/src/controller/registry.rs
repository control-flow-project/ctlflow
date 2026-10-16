use super::*;
use crate::resume_selection::Selections;

pub enum Edit {
    Add(Instance),
    Remove(String),
    Definition {
        instance: String,
        definition: String,
    },
}
struct Mutation<'a, R, E, T>(&'a Controller<R, E, T>, String);
impl<R, E, T> Drop for Mutation<'_, R, E, T> {
    fn drop(&mut self) {
        if let Ok(mut state) = self.0.state.lock() {
            state.mutations.remove(&self.1);
        }
        self.0
            .changed
            .send_modify(|revision| *revision = revision.wrapping_add(1));
    }
}
impl<R: Registry + 'static, E: Execution + 'static, T: Clock + Clone + Send + Sync + 'static>
    Controller<R, E, T>
{
    pub(super) fn persist(&self, state: &mut State, records: Vec<Registration>) -> Result<()> {
        self.registry.save_registrations(&records)?;
        state.records = records;
        Ok(())
    }
    pub(super) fn intent(
        &self,
        state: &mut State,
        fleet: &str,
        instances: &[String],
        enabled: bool,
    ) -> Result<()> {
        let mut next = state.wanted.clone();
        for instance in instances {
            let key = (fleet.to_owned(), instance.clone());
            if enabled {
                next.insert(key);
            } else {
                next.remove(&key);
            }
        }
        self.registry.save_desired(
            &next
                .iter()
                .map(|(fleet, instance)| DesiredIntent {
                    fleet_id: fleet.clone(),
                    instance_key: instance.clone(),
                })
                .collect::<Vec<_>>(),
        )?;
        state.wanted = next;
        Ok(())
    }
    pub(super) fn save_selection(
        &self,
        state: &mut State,
        fleet: &str,
        enabled: &[String],
        instance: Option<&str>,
    ) -> Result<()> {
        let mut selections = Selections::load(self.registry.as_ref(), &state.records)?;
        selections.stop(fleet, enabled, instance)?;
        if let Some(keys) = selections.view(fleet) {
            state.selections.insert(fleet.to_owned(), keys);
        }
        Ok(())
    }
    fn forget_selection(
        &self,
        state: &mut State,
        fleet: &str,
        instance: Option<&str>,
    ) -> Result<()> {
        let mut selections = Selections::load(self.registry.as_ref(), &state.records)?;
        selections.forget(fleet, instance)?;
        match selections.view(fleet) {
            Some(keys) => {
                state.selections.insert(fleet.to_owned(), keys);
            }
            None => {
                state.selections.remove(fleet);
            }
        }
        Ok(())
    }
    pub fn add(self: &Arc<Self>, directory: &Path) -> Result<FleetState> {
        let configuration = self.registry.load(directory)?;
        self.execution.validate(&configuration)?;
        let record = {
            let mut state = self.lock()?;
            if state.stopping {
                return Err(failed("Controller is stopping"));
            }
            if state.records.iter().any(|record| {
                record.directory == directory || record.fleet_key == configuration.roster.fleet
            }) {
                return Err(conflict("Fleet directory or key is already registered"));
            }
            if state.records.len() >= 100 {
                return Err(Failure::new(
                    ErrorCode::Capacity,
                    "Controller supports at most 100 registered fleets",
                ));
            }
            let record = Registration {
                fleet_id: crossfire_kernel::identity::id(),
                fleet_key: configuration.roster.fleet.clone(),
                label: configuration.roster.fleet.clone(),
                directory: directory.to_owned(),
                revision: 0,
                digest: configuration.digest.clone(),
            };
            let mut records = state.records.clone();
            records.push(record.clone());
            self.persist(&mut state, records)?;
            record
        };
        self.connect(&configuration)?;
        self.view(&record.fleet_id)
    }
    fn mutable(
        &self,
        state: &State,
        fleet: &str,
        revision: i64,
    ) -> Result<(Registration, Configuration)> {
        if state.stopping || state.mutations.contains(fleet) {
            return Err(conflict(
                "Controller is stopping or a roster change is in progress",
            ));
        }
        let current = self.inspect(state, fleet)?;
        if current.0.revision != revision {
            return Err(Failure::new(
                ErrorCode::StaleRevision,
                "Refresh the fleet before changing it",
            ));
        }
        if Self::executing(state, fleet) {
            return Err(conflict(
                "Stop this fleet before changing its registry or roster",
            ));
        }
        Ok(current)
    }
    pub fn rename(&self, fleet: &str, revision: i64, label: &str) -> Result<FleetState> {
        if label.is_empty()
            || label.encode_utf16().count() > 100
            || label
                .chars()
                .any(|character| character <= '\u{1f}' || character == '\u{7f}')
        {
            return Err(Failure::new(ErrorCode::Invalid, "Invalid fleet label"));
        }
        let mut state = self.lock()?;
        self.mutable(&state, fleet, revision)?;
        let next_revision = revision
            .checked_add(1)
            .ok_or_else(|| conflict("Fleet revision overflow"))?;
        let records = state
            .records
            .iter()
            .cloned()
            .map(|mut record| {
                if record.fleet_id == fleet {
                    record.label = label.to_owned();
                    record.revision = next_revision;
                }
                record
            })
            .collect();
        self.persist(&mut state, records)?;
        self.view_locked(&state, fleet)
    }
    pub async fn remove(&self, fleet: &str, revision: i64, stop: CancellationToken) -> Result<()> {
        let configuration = {
            let mut state = self.lock()?;
            let configuration = self.mutable(&state, fleet, revision)?.1;
            state.mutations.insert(fleet.to_owned());
            configuration
        };
        let _mutation = Mutation(self, fleet.to_owned());
        self.execution.archive(&configuration, stop).await?;
        {
            let mut state = self.lock()?;
            self.forget_selection(&mut state, fleet, None)?;
            let records = state
                .records
                .iter()
                .filter(|record| record.fleet_id != fleet)
                .cloned()
                .collect();
            self.persist(&mut state, records)?;
            state.deployed.remove(fleet);
            state.instances.retain(|(selected, _), _| selected != fleet);
        }
        self.execution.disconnect(&configuration).await
    }
    pub async fn edit(
        &self,
        fleet: &str,
        revision: i64,
        edit: Edit,
        stop: CancellationToken,
    ) -> Result<FleetState> {
        let mut configuration = {
            let mut state = self.lock()?;
            let configuration = self.mutable(&state, fleet, revision)?.1;
            state.mutations.insert(fleet.to_owned());
            configuration
        };
        let _mutation = Mutation(self, fleet.to_owned());
        let key = match &edit {
            Edit::Add(instance) => &instance.key,
            Edit::Remove(key) => key,
            Edit::Definition { instance, .. } => instance,
        }
        .clone();
        let existing = configuration
            .roster
            .instances
            .iter()
            .find(|instance| instance.key == key)
            .cloned();
        match edit {
            Edit::Add(instance) => {
                if existing.is_some()
                    || configuration
                        .roster
                        .instances
                        .iter()
                        .any(|current| current.name == instance.name)
                {
                    return Err(Failure::new(
                        ErrorCode::NameCollision,
                        "Instance key or agent name is already registered",
                    ));
                }
                configuration.roster.instances.push(instance);
            }
            Edit::Remove(_) => {
                let existing = existing.ok_or_else(|| missing("Instance does not exist"))?;
                self.execution
                    .remove(&configuration, &existing, stop)
                    .await?;
                self.forget_selection(&mut *self.lock()?, fleet, Some(&key))?;
                configuration
                    .roster
                    .instances
                    .retain(|instance| instance.key != key);
            }
            Edit::Definition { definition, .. } => {
                let instance = configuration
                    .roster
                    .instances
                    .iter_mut()
                    .find(|instance| instance.key == key)
                    .ok_or_else(|| missing("Instance does not exist"))?;
                instance.definition = definition;
            }
        }
        let preview = self
            .registry
            .preview_roster(&configuration, &configuration.roster)?;
        self.execution.validate(&preview)?;
        let changed = self
            .registry
            .write_roster(&configuration, &configuration.roster)?;
        self.execution.validate(&changed)?;
        let mut state = self.lock()?;
        let next_revision = revision
            .checked_add(1)
            .ok_or_else(|| conflict("Fleet revision overflow"))?;
        let records = state
            .records
            .iter()
            .cloned()
            .map(|mut record| {
                if record.fleet_id == fleet {
                    record.digest = changed.digest.clone();
                    record.revision = next_revision;
                }
                record
            })
            .collect();
        self.persist(&mut state, records)?;
        state.instances.remove(&(fleet.to_owned(), key));
        self.view_locked(&state, fleet)
    }
}
