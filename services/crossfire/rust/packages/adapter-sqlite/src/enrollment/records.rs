use super::rows::{ItemRow, RequestRow};
use crate::{
    error::failure,
    store::Store,
    tables::{
        enrollment_controller_metadata, enrollment_item, enrollment_request,
        fleet_controller_metadata,
    },
};
use crossfire_domain::{
    enrollment::values::{Item, Request},
    identity::Page,
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use diesel::prelude::*;
use std::collections::BTreeMap;
pub(super) fn affected(count: usize) -> Result<()> {
    if count == 1 {
        Ok(())
    } else {
        Err(Failure::new(
            ErrorCode::Missing,
            "Enrollment record not found",
        ))
    }
}
pub(super) fn request(store: &mut Store, id: &str) -> Result<Option<Request>> {
    enrollment_request::table
        .filter(enrollment_request::id.eq(id))
        .select(RequestRow::as_select())
        .first::<RequestRow>(store.database.connection())
        .optional()
        .map_err(failure)?
        .map(Request::try_from)
        .transpose()
}
pub(super) fn save_request(store: &mut Store, value: &Request, insert: bool) -> Result<()> {
    let row = RequestRow::from(value);
    if insert {
        diesel::insert_into(enrollment_request::table)
            .values(&row)
            .execute(store.database.connection())
            .map_err(failure)?;
    } else {
        affected(
            diesel::update(enrollment_request::table.filter(enrollment_request::id.eq(&value.id)))
                .set(&row)
                .execute(store.database.connection())
                .map_err(failure)?,
        )?;
    }
    Ok(())
}
pub(super) fn expired(store: &mut Store, now: i64) -> Result<Vec<Request>> {
    enrollment_request::table
        .filter(
            enrollment_request::status
                .eq("pending")
                .and(enrollment_request::expires_at.le(now)),
        )
        .select(RequestRow::as_select())
        .load::<RequestRow>(store.database.connection())
        .map_err(failure)?
        .into_iter()
        .map(Request::try_from)
        .collect()
}
pub(super) fn pending(store: &mut Store) -> Result<i64> {
    enrollment_request::table
        .filter(enrollment_request::status.eq("pending"))
        .count()
        .get_result(store.database.connection())
        .map_err(failure)
}
pub(super) fn page(
    store: &mut Store,
    owner: Option<&str>,
    page: i64,
    size: i64,
) -> Result<Page<Request>> {
    if !(1..=100000).contains(&page) || !(1..=100).contains(&size) {
        return Err(Failure::new(
            ErrorCode::Invalid,
            "Use page ≥ 1 and pageSize 1–100",
        ));
    }
    let mut count = enrollment_request::table.into_boxed();
    let mut items = enrollment_request::table.into_boxed();
    if let Some(owner) = owner {
        count = count.filter(enrollment_request::owner_id.eq(owner));
        items = items.filter(enrollment_request::owner_id.eq(owner));
    }
    let total = count
        .count()
        .get_result::<i64>(store.database.connection())
        .map_err(failure)?;
    let items = items
        .order((
            enrollment_request::created_at.desc(),
            enrollment_request::id.desc(),
        ))
        .limit(size)
        .offset((page - 1) * size)
        .select(RequestRow::as_select())
        .load::<RequestRow>(store.database.connection())
        .map_err(failure)?
        .into_iter()
        .map(Request::try_from)
        .collect::<Result<Vec<_>>>()?;
    Ok(Page {
        items,
        page,
        page_size: size,
        total_items: total,
        total_pages: (total + size - 1) / size,
    })
}
pub(super) fn items(store: &mut Store, id: &str) -> Result<Vec<Item>> {
    enrollment_item::table
        .filter(enrollment_item::request_id.eq(id))
        .order(enrollment_item::instance_key.asc())
        .select(ItemRow::as_select())
        .load::<ItemRow>(store.database.connection())
        .map_err(failure)?
        .into_iter()
        .map(Item::try_from)
        .collect()
}
pub(super) fn save_item(store: &mut Store, value: &Item, insert: bool) -> Result<()> {
    let row = ItemRow::from(value);
    if insert {
        diesel::insert_into(enrollment_item::table)
            .values(&row)
            .execute(store.database.connection())
            .map_err(failure)?;
    } else {
        affected(
            diesel::update(
                enrollment_item::table.filter(
                    enrollment_item::request_id
                        .eq(&value.request_id)
                        .and(enrollment_item::instance_key.eq(&value.instance_key)),
                ),
            )
            .set(&row)
            .execute(store.database.connection())
            .map_err(failure)?,
        )?;
    }
    Ok(())
}
pub(super) fn insert_metadata(store: &mut Store, id: &str, key: &str, value: &str) -> Result<()> {
    diesel::insert_into(enrollment_controller_metadata::table)
        .values((
            enrollment_controller_metadata::enrollment_id.eq(id),
            enrollment_controller_metadata::key.eq(key),
            enrollment_controller_metadata::value.eq(value),
        ))
        .execute(store.database.connection())
        .map_err(failure)?;
    Ok(())
}
pub(super) fn metadata(store: &mut Store, id: &str) -> Result<BTreeMap<String, String>> {
    enrollment_controller_metadata::table
        .filter(enrollment_controller_metadata::enrollment_id.eq(id))
        .select((
            enrollment_controller_metadata::key,
            enrollment_controller_metadata::value,
        ))
        .load::<(String, String)>(store.database.connection())
        .map_err(failure)
        .map(|values| values.into_iter().collect())
}
pub(super) fn fleet_metadata(store: &mut Store, id: &str, key: &str, value: &str) -> Result<()> {
    diesel::insert_into(fleet_controller_metadata::table)
        .values((
            fleet_controller_metadata::fleet_id.eq(id),
            fleet_controller_metadata::key.eq(key),
            fleet_controller_metadata::value.eq(value),
        ))
        .on_conflict((
            fleet_controller_metadata::fleet_id,
            fleet_controller_metadata::key,
        ))
        .do_update()
        .set(fleet_controller_metadata::value.eq(value))
        .execute(store.database.connection())
        .map_err(failure)?;
    Ok(())
}
