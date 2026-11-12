use std::{collections::BTreeMap, path::PathBuf};

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub enum Placement {
    #[default]
    Host,
    Vm {
        image: String,
        profile: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Image {
    pub path: PathBuf,
    pub sha256: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Mount {
    pub path: PathBuf,
    pub read_only: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Network {
    Disabled,
    Outbound,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Profile {
    pub cpus: u32,
    pub memory_mib: u32,
    pub maximum_memory_mib: u32,
    pub network: Network,
    pub mounts: Vec<Mount>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Catalog {
    pub memory_budget_mib: u32,
    pub host_reserve_mib: u32,
    pub images: BTreeMap<String, Image>,
    pub profiles: BTreeMap<String, Profile>,
}
