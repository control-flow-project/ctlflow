use crossfire_adapter_sqlite::store::Store;
use crossfire_domain::{
    identity::{Member, Principal, PrincipalKind, Role, Status},
    port::{AuthorizationRepository, CoreRepository, UnitOfWork},
    registration,
};
use serde_json::json;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let arguments: Vec<_> = std::env::args().collect();
    if arguments.len() != 4 || !["read", "write"].contains(&arguments[1].as_str()) {
        return Err("Expected read/write, Knex-prepared private database path and UUID".into());
    }
    let mut store = Store::open(std::path::Path::new(&arguments[2]))?;
    let id = &arguments[3];
    if arguments[1] == "write" {
        store.transaction(|store| {
            let principal = Principal {
                id: id.clone(),
                matrix_user_id: format!("@rust-{id}:example.test"),
                kind: PrincipalKind::Human,
                status: Status::Active,
                revision: 0,
                created_at: 1_792_000_000_000,
            };
            registration::register(store, &principal, Role::Member, None, principal.created_at)?;
            store.insert_member(&Member {
                principal_id: id.clone(),
                display_name: "Portable native record".to_owned(),
            })
        })?;
    }
    let identity = store.schema_identity()?;
    let principal = store.principal(id)?;
    let data = json!({"application":identity.0,"version":identity.1,"id":principal.as_ref().map(|value| value.id.as_str()),
        "matrixUserId":principal.as_ref().map(|value| value.matrix_user_id.as_str()),"createdAt":principal.as_ref().map(|value| value.created_at),
        "permissions":if principal.is_some() { store.permissions(id)?.into_iter().map(|permission| permission.code()).collect::<Vec<_>>() } else { Vec::new() }});
    println!("{data}");
    Ok(())
}
