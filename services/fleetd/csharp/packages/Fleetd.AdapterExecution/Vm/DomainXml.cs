using System.Globalization;
using System.Xml.Linq;
using Crossfire.Contracts;
using Fleetd.Contracts;
using Fleetd.Domain;

namespace Fleetd.AdapterExecution.Vm;

public sealed record VmHostFiles(string Qemu, string Virtiofsd, string FirmwareCode, string FirmwareVariables)
{
    public static VmHostFiles Installed { get; } = new("/usr/bin/qemu-system-x86_64", "/usr/libexec/virtiofsd", "/usr/share/OVMF/OVMF_CODE_4M.fd", "/usr/share/OVMF/OVMF_VARS_4M.fd");
}
public sealed record VmBootFiles(string Overlay, string Seed, string Nvram, string Serial, string Bootstrap, string Channel);

public static class DomainXml
{
    private static XElement Element(string name, object? value = null, params XAttribute[] attributes)
        => value is null ? new(name, attributes) : new(name, attributes, value);
    private static XAttribute Attribute(string name, object value) => new(name, value);
    public static string Create(string id, VmProfile profile, IReadOnlyList<VmMount> mounts, VmBootFiles files, VmHostFiles host)
    {
        var paths = new[] { files.Overlay, files.Seed, files.Nvram, files.Serial, files.Bootstrap, files.Channel,
            host.Qemu, host.Virtiofsd, host.FirmwareCode, host.FirmwareVariables };
        if (!Validation.Identifier(id) || paths.Any(path => !FleetConfigurationContract.Absolute(path) || path.Any(char.IsControl))
            || profile.Cpus is < 1 or > 64 || profile.MemoryMiB < 256 || profile.MaximumMemoryMiB < profile.MemoryMiB
            || !Enum.IsDefined(profile.Network) || mounts.Count is < 1 or > 102
            || mounts.Any(mount => !FleetConfigurationContract.Absolute(mount.Path) || mount.Path.Any(char.IsControl)))
            throw new ArgumentException("Invalid VM domain identity, hardware or files");
        var firmware = Element("os");
        firmware.Add(Element("type", "hvm", Attribute("arch", "x86_64"), Attribute("machine", "q35")),
            Element("loader", host.FirmwareCode, Attribute("readonly", "yes"), Attribute("type", "pflash")),
            Element("nvram", files.Nvram, Attribute("template", host.FirmwareVariables)),
            Element("boot", null, Attribute("dev", "hd")), Element("smbios", null, Attribute("mode", "sysinfo")));
        var devices = Element("devices"); devices.Add(Element("emulator", host.Qemu));
        foreach (var (path, format, target, readOnly) in new[] { (files.Overlay, "qcow2", "vda", false), (files.Seed, "raw", "vdb", true) })
        {
            var disk = Element("disk", null, Attribute("type", "file"), Attribute("device", "disk"));
            disk.Add(Element("driver", null, Attribute("name", "qemu"), Attribute("type", format)),
                Element("source", null, Attribute("file", path)), Element("target", null, Attribute("dev", target), Attribute("bus", "virtio")));
            if (readOnly) disk.Add(Element("readonly")); devices.Add(disk);
        }
        foreach (var (path, tag, readOnly) in mounts.Select((mount, index) => (mount.Path, Bootstrap.Tag(index), mount.ReadOnly))
            .Append((files.Bootstrap, Bootstrap.BootTag, true)))
        {
            var filesystem = Element("filesystem", null, Attribute("type", "mount"), Attribute("accessmode", "passthrough"));
            filesystem.Add(Element("driver", null, Attribute("type", "virtiofs"), Attribute("queue", "128")),
                Element("source", null, Attribute("dir", path)), Element("target", null, Attribute("dir", tag)),
                Element("binary", Element("thread_pool", null, Attribute("size", "4")), Attribute("path", host.Virtiofsd)));
            if (readOnly) filesystem.Add(Element("readonly")); devices.Add(filesystem);
        }
        devices.Add(Element("serial", new[] { Element("source", null, Attribute("path", files.Serial)), Element("target", null, Attribute("port", "0")) }, Attribute("type", "file")),
            Element("channel", new[] { Element("source", null, Attribute("mode", "bind"), Attribute("path", files.Channel)), Element("target", null, Attribute("type", "virtio"), Attribute("name", Bootstrap.Channel)) }, Attribute("type", "unix")),
            Element("memballoon", null, Attribute("model", "virtio"), Attribute("freePageReporting", "on")));
        if (profile.Network == VmNetwork.Outbound) devices.Add(Element("interface", Element("model", null, Attribute("type", "virtio")), Attribute("type", "user")));
        return Element("domain", new object[] {
            // Each execution has its own libvirt daemon. Keep its local name
            // short for monitor sockets; the UUID retains the full identity.
            Element("name", "vm"), Element("uuid", id),
            Element("memory", profile.MaximumMemoryMiB.ToString(CultureInfo.InvariantCulture), Attribute("unit", "MiB")),
            Element("currentMemory", profile.MemoryMiB.ToString(CultureInfo.InvariantCulture), Attribute("unit", "MiB")),
            Element("vcpu", profile.Cpus.ToString(CultureInfo.InvariantCulture)),
            Element("memoryBacking", new[] { Element("source", null, Attribute("type", "memfd")), Element("access", null, Attribute("mode", "shared")) }),
            firmware, Element("sysinfo", Element("system", Element("entry", "ds=nocloud", Attribute("name", "serial"))), Attribute("type", "smbios")),
            Element("features", new[] { Element("acpi"), Element("apic") }),
            Element("cpu", null, Attribute("mode", "host-passthrough"), Attribute("check", "none"), Attribute("migratable", "off")),
            Element("on_poweroff", "destroy"), Element("on_reboot", "destroy"), Element("on_crash", "destroy"), devices
        }, Attribute("type", "kvm")).ToString(SaveOptions.DisableFormatting);
    }
}
