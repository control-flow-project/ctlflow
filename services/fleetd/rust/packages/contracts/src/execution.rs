use crate::configuration::absolute_path;
use crossfire_contracts::validation as check;
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use fleetd_domain::execution::*;
use serde_json::{Value, json};
use std::{collections::BTreeMap, path::PathBuf};

fn invalid(message: &str) -> Failure {
    Failure::new(ErrorCode::Invalid, message)
}

pub fn validate<'a>(
    placements: impl IntoIterator<Item = &'a Placement>,
    catalog: Option<&Catalog>,
) -> Result<()> {
    for placement in placements {
        if let Placement::Vm { image, profile } = placement
            && !catalog.is_some_and(|catalog| {
                catalog.images.contains_key(image) && catalog.profiles.contains_key(profile)
            })
        {
            return Err(invalid(
                "VM execution must reference an image and profile in this fleet execution catalog",
            ));
        }
    }
    Ok(())
}

pub fn placement(value: &Value) -> Result<Placement> {
    let source = check::object(value, &["kind"], &["image", "profile"])?;
    match check::choice(&source["kind"], &["host", "vm"])? {
        "host" => {
            check::object(value, &["kind"], &[])?;
            Ok(Placement::Host)
        }
        "vm" => {
            let source = check::object(value, &["kind", "image", "profile"], &[])?;
            Ok(Placement::Vm {
                image: check::name(&source["image"])?.to_owned(),
                profile: check::name(&source["profile"])?.to_owned(),
            })
        }
        _ => Err(invalid("Select host or VM execution")),
    }
}

pub fn placement_wire(value: &Placement) -> Value {
    match value {
        Placement::Host => json!({"kind":"host"}),
        Placement::Vm { image, profile } => json!({"kind":"vm","image":image,"profile":profile}),
    }
}

fn absolute(value: &Value) -> Result<PathBuf> {
    let text = check::text(value, 1, 4096)?;
    if !absolute_path(text) {
        return Err(invalid("Use an absolute normalized path"));
    }
    Ok(PathBuf::from(text))
}

fn image(value: &Value) -> Result<Image> {
    let source = check::object(value, &["path", "sha256"], &[])?;
    let sha256 = check::text(&source["sha256"], 64, 64)?;
    if !sha256
        .bytes()
        .all(|value| value.is_ascii_digit() || (b'a'..=b'f').contains(&value))
    {
        return Err(invalid("Use a lowercase SHA256 digest"));
    }
    Ok(Image {
        path: absolute(&source["path"])?,
        sha256: sha256.to_owned(),
    })
}

fn mount(value: &Value) -> Result<Mount> {
    let source = check::object(value, &["path", "read_only"], &[])?;
    Ok(Mount {
        path: absolute(&source["path"])?,
        read_only: check::boolean(&source["read_only"])?,
    })
}

fn memory(value: &Value) -> Result<u32> {
    u32::try_from(check::integer(value, 256, 1048576)?).map_err(|_| invalid("Invalid VM memory"))
}

fn profile(value: &Value) -> Result<Profile> {
    let source = check::object(
        value,
        &[
            "cpus",
            "memory_mib",
            "maximum_memory_mib",
            "network",
            "mounts",
        ],
        &[],
    )?;
    let cpus = u32::try_from(check::integer(&source["cpus"], 1, 64)?)
        .map_err(|_| invalid("Invalid VM CPU count"))?;
    let memory_mib = memory(&source["memory_mib"])?;
    let maximum_memory_mib = memory(&source["maximum_memory_mib"])?;
    if memory_mib > maximum_memory_mib {
        return Err(invalid("VM target must fit its maximum"));
    }
    let network = match check::choice(&source["network"], &["disabled", "outbound"])? {
        "disabled" => Network::Disabled,
        "outbound" => Network::Outbound,
        _ => return Err(invalid("Invalid VM network selection")),
    };
    let values = check::list(&source["mounts"], 0, 100)?;
    let mounts: Vec<_> = values.iter().map(mount).collect::<Result<_>>()?;
    for (index, mount) in mounts.iter().enumerate() {
        if mounts
            .iter()
            .skip(index + 1)
            .any(|other| mount.path.starts_with(&other.path) || other.path.starts_with(&mount.path))
        {
            return Err(invalid("VM profile mounts cannot duplicate or overlap"));
        }
    }
    Ok(Profile {
        cpus,
        memory_mib,
        maximum_memory_mib,
        network,
        mounts,
    })
}

fn named<T>(value: &Value, parse: impl Fn(&Value) -> Result<T>) -> Result<BTreeMap<String, T>> {
    let source = value
        .as_object()
        .ok_or_else(|| invalid("Expected named execution definitions"))?;
    if source.is_empty() || source.len() > 100 {
        return Err(invalid("Use 1–100 named execution definitions"));
    }
    source
        .iter()
        .map(|(name, value)| {
            check::name(&Value::String(name.clone()))?;
            Ok((name.clone(), parse(value)?))
        })
        .collect()
}

pub fn catalog(value: &Value) -> Result<Catalog> {
    let source = check::object(
        value,
        &[
            "memory_budget_mib",
            "host_reserve_mib",
            "images",
            "profiles",
        ],
        &[],
    )?;
    let memory_budget_mib =
        u32::try_from(check::integer(&source["memory_budget_mib"], 512, 1048576)?)
            .map_err(|_| invalid("Invalid controller memory budget"))?;
    let host_reserve_mib = memory(&source["host_reserve_mib"])?;
    let images = named(&source["images"], image)?;
    let profiles = named(&source["profiles"], profile)?;
    if profiles
        .values()
        .any(|profile| profile.maximum_memory_mib > memory_budget_mib)
    {
        return Err(invalid("VM maximum must fit the controller memory budget"));
    }
    Ok(Catalog {
        memory_budget_mib,
        host_reserve_mib,
        images,
        profiles,
    })
}
