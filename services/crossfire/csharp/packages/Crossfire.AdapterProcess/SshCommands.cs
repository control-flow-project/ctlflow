using System.Globalization;
using Crossfire.Kernel;

namespace Crossfire.AdapterProcess;

public sealed record SshExecution(string Directory, string Id);

// The keys are native adapter contracts, never the ambient controller environment.
// Provider login uses the managed home or its explicitly selected native key;
// neither ambient credentials nor a global host home are guest exports.
public static class SshCommands
{
    public const string ProviderKey = "CROSSFIRE_PROVIDER_ENV_KEY";
    public const string ProviderSecret = "CROSSFIRE_PROVIDER_SECRET";
    private static readonly HashSet<string> EnvironmentKeys = new(StringComparer.Ordinal)
    { "CODEX_HOME", "PI_CODING_AGENT_DIR", "CROSSFIRE_PROJECT", "CROSSFIRE_AGENT_NAME" };
    public const string GuestPath = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
    private static string Quote(string value) => "'" + value.Replace("'", "'\\''", StringComparison.Ordinal) + "'";
    private static bool Text(string value) => !value.Contains('\0') && System.Text.Encoding.UTF8.GetByteCount(value) <= 1048576;
    private static bool Absolute(string path) => path.StartsWith('/') && !path.Contains('\\') && !path.Contains('\0')
        && path.Split('/').Skip(1).All(part => part.Length != 0 && part is not ("." or ".."));
    private static bool Valid(string directory, string id) => Absolute(directory)
        && directory.Length < 70 && directory.All(character => char.IsAsciiLetterOrDigit(character) || character is '/' or '.' or '-' or '_')
        && IdentitySyntax.Identifier(id);
    private static string Alias(string id) => "ctlflow-" + id;
    private static string Number(int port) => port.ToString(CultureInfo.InvariantCulture);

    private static List<string> Multiplex(string directory) => ["-F", "/dev/null", "-T", "-S", Path.Combine(directory, "mux"),
        "-o", "ControlMaster=no", "-o", "BatchMode=yes", "-o", "IdentityAgent=none", "-o", "ProxyCommand=/usr/bin/false"];

    public static Result<NativeCommand> Master(string directory, string id, int? listenerPort)
    {
        if (!Valid(directory, id) || listenerPort is < 1 or > 65535)
            return Results.Fail<NativeCommand>("invalid", "Invalid private VM SSH connection identity or listener port");
        List<string> arguments = ["-F", "/dev/null", "-M", "-N", "-T", "-S", Path.Combine(directory, "mux"),
            "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes", "-o", "IdentityAgent=none", "-i", Path.Combine(directory, "client"),
            "-o", "StrictHostKeyChecking=yes", "-o", "GlobalKnownHostsFile=/dev/null", "-o", "UserKnownHostsFile=" + Path.Combine(directory, "known_hosts"),
            "-o", "HostKeyAlias=" + Alias(id), "-o", "ConnectionAttempts=1", "-o", "ConnectTimeout=30", "-o", "ExitOnForwardFailure=yes",
            "-o", "SendEnv=" + ProviderSecret,
            "-o", "ProxyCommand=/usr/bin/nc -N -U " + Quote(Path.Combine(directory, "channel"))];
        if (listenerPort is { } port) { arguments.Add("-R"); arguments.Add("127.0.0.1:" + Number(port) + ":127.0.0.1:" + Number(port)); }
        arguments.Add("root@" + Alias(id));
        return Result<NativeCommand>.Success(new("/usr/bin/ssh", arguments, directory, new Dictionary<string, string?> { [ProviderSecret] = null }));
    }

    public static Result<NativeCommand> Place(string directory, string id, NativeCommand command)
    {
        if (!Valid(directory, id) || !Absolute(command.Workspace) || command.Workspace.Any(char.IsControl)
            || command.Binary.Length == 0 || !Text(command.Binary) || command.Arguments.Any(argument => !Text(argument))
            || command.Environment.Any(entry => EnvironmentKeys.Contains(entry.Key) && entry.Value is { } value && !Text(value)))
            return Results.Fail<NativeCommand>("invalid", "Invalid guest native command");
        var environment = new List<string> { "HOME=/root", "LANG=C.UTF-8", "PATH=" + GuestPath };
        environment.AddRange(command.Environment.Where(entry => EnvironmentKeys.Contains(entry.Key) && entry.Value is not null)
            .OrderBy(entry => entry.Key, StringComparer.Ordinal).Select(entry => entry.Key + "=" + entry.Value));
        string? provider = null, secret = null;
        if (command.Environment.TryGetValue(ProviderKey, out provider) && provider is not null)
        {
            if (provider.Length is < 1 or > 128 || provider.Where((character, index) => !(char.IsAsciiLetter(character) || character == '_' || index > 0 && char.IsAsciiDigit(character))).Any()
                || EnvironmentKeys.Contains(provider) || provider is ProviderKey or ProviderSecret or "HOME" or "LANG" or "PATH"
                || !command.Environment.TryGetValue(provider, out secret) || string.IsNullOrWhiteSpace(secret) || !Text(secret)
                || System.Text.Encoding.UTF8.GetByteCount(secret) > 65536)
                return Results.Fail<NativeCommand>("invalid", "Invalid explicitly selected native provider environment key");
        }
        var remote = "cd -- " + Quote(command.Workspace) + " && exec /usr/bin/env -i -- " + string.Join(' ', environment.Select(Quote))
            + (provider is null ? "" : " " + Quote(provider) + "=\"${" + ProviderSecret + ":?Missing selected native provider key}\"")
            + " " + string.Join(' ', new[] { command.Binary }.Concat(command.Arguments).Select(Quote));
        if (!Text(remote)) return Results.Fail<NativeCommand>("invalid", "Guest native command exceeds its byte bound");
        var arguments = Multiplex(directory);
        if (provider is not null) arguments.AddRange(["-o", "SendEnv=" + ProviderSecret]);
        arguments.Add("root@" + Alias(id)); arguments.Add(remote);
        return Result<NativeCommand>.Success(new("/usr/bin/ssh", arguments, directory, new Dictionary<string, string?> { [ProviderSecret] = secret }, command.Input));
    }

    public static Result<NativeCommand> Check(string directory, string id)
    {
        if (!Valid(directory, id)) return Results.Fail<NativeCommand>("invalid", "Invalid private VM SSH connection identity");
        var arguments = Multiplex(directory); arguments.AddRange(["-O", "check", "root@" + Alias(id)]);
        return Result<NativeCommand>.Success(new("/usr/bin/ssh", arguments, directory, new Dictionary<string, string?>()));
    }

    public static Result<string> Terminal(SshExecution execution, string workspace, string script)
    {
        var placed = Place(execution.Directory, execution.Id, new("/bin/sh", ["-c", script], workspace, new Dictionary<string, string?>(), true));
        return placed.Map(command => string.Join(' ', new[] { command.Binary }.Concat(command.Arguments.Select(argument => argument == "-T" ? "-tt" : argument)).Select(Quote)));
    }

    public static Result<NativeCommand> Forward(string directory, string id, int localPort, int guestPort)
    {
        if (!Valid(directory, id) || localPort is < 1 or > 65535 || guestPort is < 1 or > 65535)
            return Results.Fail<NativeCommand>("invalid", "Invalid guest endpoint forwarding request");
        var arguments = Multiplex(directory); arguments.AddRange(["-O", "forward", "-o", "ExitOnForwardFailure=yes", "-L",
            "127.0.0.1:" + Number(localPort) + ":127.0.0.1:" + Number(guestPort), "root@" + Alias(id)]);
        return Result<NativeCommand>.Success(new("/usr/bin/ssh", arguments, directory, new Dictionary<string, string?>()));
    }
}
