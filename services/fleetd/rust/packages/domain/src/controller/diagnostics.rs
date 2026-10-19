use super::*;
use crate::diagnostics::{Report, Scope};
use crossfire_agent_core::owned_runtime::{NativeDiagnostic, ProviderState};

impl<R: Registry + 'static, E: Execution + 'static, T: Clock + Clone + Send + Sync + 'static>
    Controller<R, E, T>
{
    pub async fn diagnostics(
        self: &Arc<Self>,
        scope: Scope,
        stop: CancellationToken,
    ) -> Result<Report> {
        if scope.instance_key.is_some() && scope.fleet_id.is_none() {
            return Err(Failure::new(
                ErrorCode::Invalid,
                "An instance requires a fleet",
            ));
        }
        if let Some(fleet) = &scope.fleet_id
            && !self
                .lock()?
                .records
                .iter()
                .any(|record| record.fleet_id == *fleet)
        {
            return Err(missing("Fleet is not registered"));
        }
        let checked_at = self.clock.now()?;
        let controller_scope = Scope {
            fleet_id: None,
            instance_key: None,
        };
        let mut report = Report {
            checked_at,
            scope: scope.clone(),
            checks: vec![],
        };
        report.add(
            "controller.connection",
            &controller_scope,
            "pass",
            Some(checked_at),
            "Authenticated controller API is reachable",
            None,
        );
        let stopping = self.stopping()?;
        report.add(
            "controller.lifecycle",
            &controller_scope,
            if stopping { "fail" } else { "pass" },
            Some(checked_at),
            if stopping {
                "Controller is stopping"
            } else {
                "Controller is running"
            },
            stopping.then_some("Start the controller after shutdown completes"),
        );
        let Some(fleet_id) = &scope.fleet_id else {
            return Ok(report);
        };
        let fleet_scope = Scope {
            fleet_id: Some(fleet_id.clone()),
            instance_key: None,
        };
        let fleet = match self.view(fleet_id) {
            Ok(fleet) => fleet,
            Err(_) => {
                report.add(
                    "fleet.configuration",
                    &fleet_scope,
                    "fail",
                    Some(checked_at),
                    "Registered fleet configuration cannot be loaded",
                    Some("Correct the registered directory and fleet configuration"),
                );
                report.add(
                    "fleet.connection",
                    &fleet_scope,
                    "unknown",
                    None,
                    "Fleet connection cannot be evaluated without its configuration",
                    None,
                );
                return Ok(report);
            }
        };
        let instances = fleet
            .instances
            .into_iter()
            .filter(|instance| {
                scope
                    .instance_key
                    .as_ref()
                    .is_none_or(|key| *key == instance.instance.key)
            })
            .collect::<Vec<_>>();
        if scope.instance_key.is_some() && instances.is_empty() {
            return Err(missing("Instance not found"));
        }
        report.add(
            "fleet.configuration",
            &fleet_scope,
            "pass",
            Some(checked_at),
            "Registered fleet configuration is readable",
            None,
        );
        let connected = fleet.connection.connected;
        report.add(
            "fleet.connection",
            &fleet_scope,
            if connected { "pass" } else { "fail" },
            Some(checked_at),
            if connected {
                "Controller reports an active crossfire connection"
            } else {
                "Controller has no active crossfire connection"
            },
            (!connected).then_some("Check crossfire availability, enrollment and controller logs"),
        );
        report.add(
            "fleet.delivery",
            &fleet_scope,
            if connected { "pass" } else { "unknown" },
            connected.then_some(checked_at),
            if connected {
                if fleet.connection.delivery_enabled {
                    "Message delivery is enabled"
                } else {
                    "Message delivery is deliberately paused"
                }
            } else {
                "Delivery intent has not been confirmed by crossfire"
            },
            None,
        );
        let deadline = tokio::time::Instant::now() + Duration::from_secs(20);
        let probes = Arc::new(Semaphore::new(4));
        let mut jobs = tokio::task::JoinSet::new();
        for (index, instance) in instances.iter().enumerate() {
            let key = (fleet_id.clone(), instance.instance.key.clone());
            let runtime = self.lock()?.running.get(&key).cloned();
            let owner = Arc::clone(self);
            let probes = Arc::clone(&probes);
            let stop = stop.clone();
            jobs.spawn(async move {
                let Some(runtime) = runtime.filter(|runtime| !runtime.lifetime().is_cancelled()) else { return (index, None); };
                let inspect = async {
                    let _permit = probes.acquire().await.ok()?;
                    let cancellation = stop.child_token();
                    let diagnostic = tokio::time::timeout(Duration::from_secs(5), runtime.diagnostics(cancellation.clone())).await.ok().and_then(Result::ok);
                    cancellation.cancel();
                    let current = owner.lock().ok()?.running.get(&key).is_some_and(|current| Arc::ptr_eq(current, &runtime));
                    if current && !runtime.lifetime().is_cancelled() { diagnostic } else { None }
                };
                let native = tokio::select! { _ = stop.cancelled() => None, value = tokio::time::timeout_at(deadline, inspect) => value.ok().flatten() };
                (index, native)
            });
        }
        let mut observations: Vec<Option<NativeDiagnostic>> = vec![None; instances.len()];
        while let Some(result) = jobs.join_next().await {
            if let Ok((index, native)) = result {
                observations[index] = native;
            }
        }
        for (instance, native) in instances.iter().zip(observations.iter()) {
            let target = Scope {
                fleet_id: Some(fleet_id.clone()),
                instance_key: Some(instance.instance.key.clone()),
            };
            report.add(
                "agent.activation",
                &target,
                "pass",
                Some(checked_at),
                if instance.desired_active {
                    "Agent is selected for activation"
                } else {
                    "Agent is not selected for activation"
                },
                None,
            );
            let live = self
                .lock()?
                .running
                .get(&(fleet_id.clone(), instance.instance.key.clone()))
                .is_some_and(|owner| !owner.lifetime().is_cancelled());
            report.checks.push(crate::diagnostics::listener(
                instance,
                &fleet.connection,
                live,
                &target,
                checked_at,
            ));
            report.add("agent.history", &target, match instance.history_available { Some(true) => "pass", Some(false) => "fail", None => "unknown" }, instance.last_activity_at, match instance.history_available { Some(true) => "Controller previously observed a retained history binding; files were not revalidated", Some(false) => "No retained history binding was observed", None => "No saved-history observation is available" }, (instance.history_available == Some(false)).then_some("Inspect retained contexts before choosing an explicit fresh-history operation"));
            let state = native
                .as_ref()
                .map(|native| native.state.as_str())
                .unwrap_or(match instance.phase {
                    InstancePhase::Stopped => "stopped",
                    InstancePhase::Failed => "failed",
                    _ => "unknown",
                });
            report.add(
                "agent.native",
                &target,
                if matches!(state, "failed" | "unavailable") {
                    "fail"
                } else if state == "unknown" {
                    "unknown"
                } else {
                    "pass"
                },
                native.as_ref().and_then(|native| native.observed_at),
                &format!("Native state: {state}"),
                (state == "failed")
                    .then_some("Inspect the native failure and retained history before resuming"),
            );
            let provider = native
                .as_ref()
                .map_or(ProviderState::Unknown, |native| native.provider);
            let inactive = matches!(state, "stopped" | "sleeping");
            let status = match provider {
                ProviderState::Present => "pass",
                ProviderState::Missing => "fail",
                ProviderState::NotRequired => "not-applicable",
                ProviderState::Unknown => {
                    if inactive {
                        "not-applicable"
                    } else {
                        "unknown"
                    }
                }
            };
            let message = match provider {
                ProviderState::Present => {
                    "Native provider metadata is present; no inference or credential refresh was performed"
                }
                ProviderState::Missing => "Native provider metadata is missing",
                ProviderState::NotRequired => {
                    "Selected native provider does not require an account"
                }
                ProviderState::Unknown => {
                    if inactive {
                        "No native provider was started to inspect this sleeping or stopped agent"
                    } else {
                        "Provider metadata could not be observed"
                    }
                }
            };
            report.add(
                "agent.provider",
                &target,
                status,
                native
                    .as_ref()
                    .and_then(|native| native.provider_observed_at),
                message,
                (provider == ProviderState::Missing).then_some(
                    "Sign in using the selected native harness, then explicitly resume the agent",
                ),
            );
            report.add(
                "agent.input",
                &target,
                if native.as_ref().is_none_or(|native| native.pending_input) {
                    "unknown"
                } else {
                    "pass"
                },
                native.as_ref().map(|native| native.checked_at),
                native
                    .as_ref()
                    .map_or("Native input state was not observed", |native| {
                        if native.pending_input {
                            "A native message is still awaiting delivery confirmation"
                        } else {
                            "No native input is awaiting delivery confirmation"
                        }
                    }),
                None,
            );
            report.add(
                "agent.decision",
                &target,
                if native.is_none() { "unknown" } else { "pass" },
                native.as_ref().map(|native| native.checked_at),
                native
                    .as_ref()
                    .map_or("Native decision state was not observed", |native| {
                        if native.pending_decision {
                            "Agent is waiting for an owner decision"
                        } else {
                            "No owner decision is pending"
                        }
                    }),
                native
                    .as_ref()
                    .is_some_and(|native| native.pending_decision)
                    .then_some("Open the owner DM and answer the pending request"),
            );
        }
        report.checks.sort_by(|left, right| {
            left.scope
                .instance_key
                .cmp(&right.scope.instance_key)
                .then(left.id.cmp(&right.id))
        });
        Ok(report)
    }
}
