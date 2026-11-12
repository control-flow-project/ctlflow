use super::bootstrap;
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use fleetd_domain::execution::{Mount, Network, Profile};
use std::{
    fmt::Write,
    path::{Path, PathBuf},
};

pub struct HostFiles {
    pub qemu: PathBuf,
    pub virtiofsd: PathBuf,
    pub firmware_code: PathBuf,
    pub firmware_variables: PathBuf,
}
impl Default for HostFiles {
    fn default() -> Self {
        Self {
            qemu: "/usr/bin/qemu-system-x86_64".into(),
            virtiofsd: "/usr/libexec/virtiofsd".into(),
            firmware_code: "/usr/share/OVMF/OVMF_CODE_4M.fd".into(),
            firmware_variables: "/usr/share/OVMF/OVMF_VARS_4M.fd".into(),
        }
    }
}
pub struct BootFiles {
    pub overlay: PathBuf,
    pub seed: PathBuf,
    pub nvram: PathBuf,
    pub serial: PathBuf,
    pub bootstrap: PathBuf,
    pub channel: PathBuf,
}
fn invalid() -> Failure {
    Failure::new(
        ErrorCode::Invalid,
        "Invalid VM domain identity, hardware or files",
    )
}
fn text(path: &Path) -> Result<String> {
    let value = path
        .to_str()
        .filter(|value| {
            fleetd_contracts::configuration::absolute_path(value)
                && !value.chars().any(char::is_control)
        })
        .ok_or_else(invalid)?;
    Ok(value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;"))
}

pub fn create(
    id: &str,
    profile: &Profile,
    mounts: &[Mount],
    files: &BootFiles,
    host: &HostFiles,
) -> Result<String> {
    crossfire_contracts::validation::identifier(&serde_json::json!(id))?;
    if !(1..=64).contains(&profile.cpus)
        || profile.memory_mib < 256
        || profile.maximum_memory_mib < profile.memory_mib
        || mounts.is_empty()
        || mounts.len() > 102
    {
        return Err(invalid());
    }
    // Each execution has its own libvirt daemon. Keep its local name short
    // for monitor sockets; the UUID retains the full execution identity.
    let mut output = format!(
        "<domain type=\"kvm\"><name>vm</name><uuid>{id}</uuid>\
<memory unit=\"MiB\">{}</memory><currentMemory unit=\"MiB\">{}</currentMemory><vcpu>{}</vcpu>\
<memoryBacking><source type=\"memfd\"/><access mode=\"shared\"/></memoryBacking>\
<os><type arch=\"x86_64\" machine=\"q35\">hvm</type>\
<loader readonly=\"yes\" type=\"pflash\">{}</loader><nvram template=\"{}\">{}</nvram><boot dev=\"hd\"/><smbios mode=\"sysinfo\"/></os>\
<sysinfo type=\"smbios\"><system><entry name=\"serial\">ds=nocloud</entry></system></sysinfo>\
<features><acpi/><apic/></features><cpu mode=\"host-passthrough\" check=\"none\" migratable=\"off\"/>\
<on_poweroff>destroy</on_poweroff><on_reboot>destroy</on_reboot><on_crash>destroy</on_crash><devices><emulator>{}</emulator>",
        profile.maximum_memory_mib,
        profile.memory_mib,
        profile.cpus,
        text(&host.firmware_code)?,
        text(&host.firmware_variables)?,
        text(&files.nvram)?,
        text(&host.qemu)?
    );
    for (path, format, target, read_only) in [
        (&files.overlay, "qcow2", "vda", false),
        (&files.seed, "raw", "vdb", true),
    ] {
        write!(output, "<disk type=\"file\" device=\"disk\"><driver name=\"qemu\" type=\"{format}\"/><source file=\"{}\"/><target dev=\"{target}\" bus=\"virtio\"/>{}</disk>", text(path)?, if read_only { "<readonly/>" } else { "" }).map_err(|_| invalid())?;
    }
    for (index, (path, read_only)) in mounts
        .iter()
        .map(|mount| (&mount.path, mount.read_only))
        .chain([(&files.bootstrap, true)])
        .enumerate()
    {
        let tag = if index == mounts.len() {
            bootstrap::BOOT_TAG.to_owned()
        } else {
            bootstrap::tag(index)
        };
        write!(output, "<filesystem type=\"mount\" accessmode=\"passthrough\"><driver type=\"virtiofs\" queue=\"128\"/><source dir=\"{}\"/><target dir=\"{tag}\"/><binary path=\"{}\"><thread_pool size=\"4\"/></binary>{}</filesystem>", text(path)?, text(&host.virtiofsd)?, if read_only { "<readonly/>" } else { "" }).map_err(|_| invalid())?;
    }
    write!(output, "<serial type=\"file\"><source path=\"{}\"/><target port=\"0\"/></serial>\
<channel type=\"unix\"><source mode=\"bind\" path=\"{}\"/><target type=\"virtio\" name=\"{}\"/></channel>\
<memballoon model=\"virtio\" freePageReporting=\"on\"/>", text(&files.serial)?, text(&files.channel)?, bootstrap::CHANNEL).map_err(|_| invalid())?;
    if profile.network == Network::Outbound {
        output.push_str("<interface type=\"user\"><model type=\"virtio\"/></interface>");
    }
    output.push_str("</devices></domain>");
    Ok(output)
}
