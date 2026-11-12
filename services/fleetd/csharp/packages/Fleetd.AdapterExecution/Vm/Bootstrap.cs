using System.Text;
using Crossfire.Kernel;
using Crossfire.Contracts;
using Fleetd.Domain;
using Fleetd.Contracts;

namespace Fleetd.AdapterExecution.Vm;

public static class Bootstrap
{
    public const string Channel = "org.ctlflow.execution.ssh";
    public const string BootTag = "ctlflow-boot";
    public const string GuestRoot = "/run/ctlflow-execution";
    public static string Tag(int index) => "ctlflow-data-" + index.ToString(System.Globalization.CultureInfo.InvariantCulture);
    private static string Quote(string value) => "'" + value.Replace("'", "'\\''", StringComparison.Ordinal) + "'";
    private static string Closing(string id, string ready)
    {
        var closed = Quote(ready + ".close");
        return "[ -f " + closed + " ] && [ \"$(cat " + closed + ")\" = " + Quote(id) + " ]";
    }
    public static string Completion(string id, string ready)
    {
        if (!FleetConfigurationContract.Absolute(ready) || ready.Any(char.IsControl) || !Validation.Identifier(id))
            throw new ArgumentException("Invalid VM completion identity or readiness path");
        return "code=0\nwait \"$server\" || code=$?\nexpected=false\nif " + Closing(id, ready)
            + " && { [ \"$code\" -eq 0 ] || [ \"$code\" -eq 255 ]; }; then expected=true; fi\n"
            + "printf '{\"event\":\"guest_ssh_exit\",\"expected\":%s,\"exitCode\":%s}\\n' \"$expected\" \"$code\" >&2\n"
            + "[ \"$expected\" = true ]\n";
    }

    public static string SshConfiguration(int? listenerPort)
    {
        if (listenerPort is < 1 or > 65535) throw new ArgumentException("Invalid per-agent listener port");
        return "HostKey " + GuestRoot + "/ssh/server\nAuthorizedKeysFile " + GuestRoot + "/ssh/authorized_keys\n"
            + "AuthenticationMethods publickey\nPubkeyAuthentication yes\nPasswordAuthentication no\nKbdInteractiveAuthentication no\n"
            + "PermitEmptyPasswords no\nPermitRootLogin prohibit-password\nUsePAM no\nAllowUsers root\nStrictModes yes\n"
            + "AllowAgentForwarding no\nX11Forwarding no\nPermitUserEnvironment no\nPermitUserRC no\n"
            + "AcceptEnv CROSSFIRE_PROVIDER_SECRET\n"
            + "AllowTcpForwarding yes\nAllowStreamLocalForwarding no\nPermitOpen 127.0.0.1:*\n"
            + (listenerPort is { } port ? "PermitListen 127.0.0.1:" + port.ToString(System.Globalization.CultureInfo.InvariantCulture) + "\n" : "PermitListen none\n")
            + "GatewayPorts no\nMaxSessions 2048\nLogLevel VERBOSE\n";
    }

    public static string Script(string id, string ready, IReadOnlyList<VmMount> mounts)
    {
        if (!FleetConfigurationContract.Absolute(ready) || ready.Any(char.IsControl) || !Crossfire.Contracts.Validation.Identifier(id)
            || mounts.Count is < 1 or > 102 || mounts.Any(mount => !FleetConfigurationContract.Absolute(mount.Path) || mount.Path.Any(char.IsControl))
            || !mounts.Any(mount => !mount.ReadOnly && ready.StartsWith(mount.Path + "/", StringComparison.Ordinal)))
            throw new ArgumentException("Invalid VM bootstrap identity, readiness location or exports");
        var boot = GuestRoot + "/boot"; var output = new StringBuilder("#!/bin/sh\nset -eu\numask 077\n");
        for (var index = 0; index < mounts.Count; index++)
        {
            var mount = mounts[index];
            output.Append("mkdir -p -- ").Append(Quote(mount.Path)).Append('\n')
                .Append("mount -t virtiofs -o ").Append(mount.ReadOnly ? "ro" : "rw").Append(" -- ")
                .Append(Quote(Tag(index))).Append(' ').Append(Quote(mount.Path)).Append('\n');
        }
        output.Append("if ").Append(Closing(id, ready)).Append("; then exit 0; fi\n");
        output.Append("mkdir -p ").Append(GuestRoot).Append("/ssh /run/sshd\nchmod 0700 ").Append(GuestRoot).Append("/ssh\nchmod 0755 /run/sshd\n")
            .Append("cp -- ").Append(boot).Append("/server ").Append(GuestRoot).Append("/ssh/server\n")
            .Append("cp -- ").Append(boot).Append("/authorized_keys ").Append(GuestRoot).Append("/ssh/authorized_keys\n")
            .Append("chmod 0600 ").Append(GuestRoot).Append("/ssh/server ").Append(GuestRoot).Append("/ssh/authorized_keys\n")
            .Append("/usr/sbin/usermod --password \"$(cat ").Append(boot).Append("/account-hash)\" root\n")
            .Append("/usr/sbin/sshd -t -f ").Append(boot).Append("/sshd_config\n")
            .Append("/usr/sbin/modprobe virtio_console\n/usr/bin/udevadm wait --timeout=30 --settle /dev/virtio-ports/").Append(Channel).Append('\n')
            .Append("exec 3<>/dev/virtio-ports/").Append(Channel).Append('\n')
            .Append("/usr/sbin/sshd -i -e -f ").Append(boot).Append("/sshd_config <&3 >&3 &\nserver=$!\n")
            .Append("printf '%s\\n' ").Append(Quote(id)).Append(" > ").Append(Quote(ready + ".tmp")).Append('\n')
            .Append("mv -fT -- ").Append(Quote(ready + ".tmp")).Append(' ').Append(Quote(ready)).Append('\n')
            .Append(Completion(id, ready));
        return output.ToString();
    }

    public static string BootCommand => "set -eu; mkdir -p " + GuestRoot + "/boot; mount -t virtiofs -o ro "
        + BootTag + " " + GuestRoot + "/boot; exec /bin/sh " + GuestRoot + "/boot/start.sh";
    public static IReadOnlyList<string> StartCommand(VmNetwork network)
    {
        if (!Enum.IsDefined(network)) throw new ArgumentException("Invalid guest network selection");
        List<string> command = ["/usr/bin/systemd-run", "--quiet", "--collect", "--no-block", "--service-type=exec", "--unit=ctlflow-execution"];
        if (network == VmNetwork.Outbound) command.AddRange(["--property=After=network-online.target", "--property=Wants=network-online.target"]);
        command.AddRange(["/bin/sh", "-c", BootCommand]);
        return command;
    }
}
