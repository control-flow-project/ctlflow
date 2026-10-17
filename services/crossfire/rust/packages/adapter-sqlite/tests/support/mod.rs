use crossfire_adapter_sqlite::store::Store;
use crossfire_adapter_sqlite::{config::DatabaseConfig, db::Database, tables::agent_name};
use crossfire_domain::{
    fleet::{
        authority, control,
        values::{Credential, Fleet, Instance},
    },
    identity::{
        Actor, Agent, Authentication, Member, Principal, PrincipalKind, Role, Status, WakeMode,
    },
    listener::{self, Proof, Report},
    port::{AgentRepository, AuthorizationRepository, CoreRepository, FleetRepository, UnitOfWork},
    registration,
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode, identity, secret::Secret};
use crossfire_test_support::sqlite::PreparedDatabase;
use diesel::prelude::*;

pub const NOW: i64 = 1_792_000_000_000;

pub struct Scenario {
    pub store: Store,
    pub owner: Actor,
    pub agent: Actor,
    pub report: Report,
    prepared: PreparedDatabase,
}

impl Scenario {
    pub fn create() -> std::result::Result<Self, Box<dyn std::error::Error>> {
        let prepared = PreparedDatabase::copy()?;
        let mut store = Store::open(prepared.path())?;
        registration::initialize(&mut store, "@owner:example.test", NOW)?;
        let principal = store
            .principal_by_matrix_id("@owner:example.test")?
            .ok_or("Missing owner")?;
        let owner = Actor {
            principal_id: principal.id,
            kind: PrincipalKind::Human,
            authentication: Some(Authentication::Native {
                matrix_user_id: "@owner:example.test".to_owned(),
            }),
        };
        let fleet = Fleet {
            id: identity::id(),
            owner_id: owner.principal_id.clone(),
            fleet_key: "fixture".to_owned(),
            archived_at: None,
            delivery_enabled: true,
            label: "Fixture fleet".to_owned(),
            controller_name: "Fixture controller".to_owned(),
            revision: 0,
            created_at: NOW,
            updated_at: NOW,
        };
        store.insert_fleet(&fleet)?;
        let principal = Principal {
            id: identity::id(),
            matrix_user_id: "@agent:example.test".to_owned(),
            kind: PrincipalKind::Agent,
            status: Status::Active,
            revision: 0,
            created_at: NOW,
        };
        store.transaction(|store| {
            registration::register(
                store,
                &principal,
                Role::Agent,
                Some(&owner.principal_id),
                NOW,
            )?;
            store.insert_agent(&Agent {
                principal_id: principal.id.clone(),
                owner_id: owner.principal_id.clone(),
                wake_mode: WakeMode::Humans,
            })?;
            store.insert_fleet_instance(&Instance {
                owner_id: owner.principal_id.clone(),
                fleet_key: fleet.fleet_key.clone(),
                instance_key: "agent".to_owned(),
                agent_id: principal.id.clone(),
                retired_at: None,
            })
        })?;
        let agent = Actor {
            principal_id: principal.id.clone(),
            kind: PrincipalKind::Agent,
            authentication: Some(Authentication::Native {
                matrix_user_id: principal.matrix_user_id,
            }),
        };
        let mut database = Database::open(&DatabaseConfig::Sqlite {
            filename: prepared.path().to_owned(),
        })?;
        diesel::insert_into(agent_name::table)
            .values((
                agent_name::name.eq("agent"),
                agent_name::agent_id.eq(&agent.principal_id),
            ))
            .execute(database.connection())?;
        let credential_id = identity::id();
        let token = authority::controller_token(&credential_id, &Secret::new("claim".to_owned()));
        store.insert_fleet_credential(&Credential {
            id: credential_id,
            fleet_id: fleet.id.clone(),
            secret_hash: identity::hash(token.expose()),
            created_at: NOW,
            revoked_at: None,
        })?;
        let controller = authority::authenticate_controller(&mut store, &token)?;
        let connection_id = identity::id();
        control::report_connection(
            &mut store,
            &controller,
            &fleet.id,
            &connection_id,
            false,
            NOW,
        )?;
        let report = Report {
            run_id: identity::id(),
            release: "release-current".to_owned(),
            messages_delivered: 0,
            statistics: None,
            stopped: false,
            controller: Proof {
                fleet_id: fleet.id,
                connection_id,
                credential: token,
            },
        };
        listener::report(
            &mut store,
            &agent,
            &agent.principal_id,
            &report,
            "release-current",
            NOW,
        )?;
        Ok(Self {
            store,
            owner,
            agent,
            report,
            prepared,
        })
    }

    pub fn database(&self) -> Result<Database> {
        Database::open(&DatabaseConfig::Sqlite {
            filename: self.prepared.path().to_owned(),
        })
    }

    pub fn add_human(&mut self, matrix_id: &str) -> Result<Actor> {
        if !matrix_id.starts_with('@') {
            return Err(Failure::new(ErrorCode::Invalid, "Invalid fixture identity"));
        }
        let principal = Principal {
            id: identity::id(),
            matrix_user_id: matrix_id.to_owned(),
            kind: PrincipalKind::Human,
            status: Status::Active,
            revision: 0,
            created_at: NOW,
        };
        self.store.transaction(|store| {
            registration::register(
                store,
                &principal,
                Role::Member,
                Some(&self.owner.principal_id),
                NOW,
            )?;
            store.insert_member(&Member {
                principal_id: principal.id.clone(),
                display_name: "Guest".to_owned(),
            })
        })?;
        Ok(Actor {
            principal_id: principal.id,
            kind: PrincipalKind::Human,
            authentication: Some(Authentication::Native {
                matrix_user_id: matrix_id.to_owned(),
            }),
        })
    }
}
