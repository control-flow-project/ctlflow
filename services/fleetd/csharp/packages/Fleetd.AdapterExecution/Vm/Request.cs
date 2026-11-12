using Crossfire.AdapterFilesystem;
using Crossfire.AdapterRuntime;
using Crossfire.Contracts;
using Crossfire.Kernel;
using Fleetd.Contracts;
using Fleetd.Domain;
using Fleetd.Storage;

namespace Fleetd.AdapterExecution.Vm;

public sealed record VmRequest(string Id, string Directory, string Fleet, string Instance, string Digest,
    NativeLeaseRequest Native, int? ListenerPort)
{
    public string Scratch => ExecutionFiles.Scratch(Id);
    public string File => Path.Combine(Scratch, "request.json");
    public string Ready => Path.Combine(Native.StateDirectory, ".ctlflow-vm-" + Id + ".ready");
    public string Unit => "ctlflow-execution-" + Id + ".service";
    public void Write() => PrivateFiles.Write(File, WireJson.Bytes(WireJson.Object(writer =>
    {
        writer.WriteString("id", Id); writer.WriteString("directory", Directory); writer.WriteString("fleet", Fleet);
        writer.WriteString("instance", Instance); writer.WriteString("digest", Digest);
        writer.WriteString("ownership", Native.Directory); writer.WriteString("workspace", Native.Workspace);
        writer.WriteString("state", Native.StateDirectory); writer.WriteString("home", Native.Home);
        if (ListenerPort is { } port) writer.WriteNumber("listenerPort", port);
    })), 32768);
    public static VmRequest Read(string file)
    {
        var value = WireJson.Parse(PrivateFiles.Read(file, 32768));
        if (!Validation.Fields(value, ["id", "directory", "fleet", "instance", "digest", "ownership", "workspace", "state", "home"], ["listenerPort"]).IsSuccess)
            throw new IOException("Invalid VM supervisor request fields");
        string Text(string key) => WireJson.Text(value, key) ?? throw new IOException("Missing VM request field: " + key);
        var request = new VmRequest(Text("id"), Text("directory"), Text("fleet"), Text("instance"), Text("digest"),
            new(Text("ownership"), Text("workspace"), Text("state"), Text("home")),
            value.TryGetProperty("listenerPort", out var port) && Validation.Integer(port, 1, 65535).IsSuccess ? port.GetInt32()
                : value.TryGetProperty("listenerPort", out _) ? throw new IOException("Invalid VM listener port") : null);
        if (request.File != file) throw new IOException("VM request must remain in its private execution directory");
        return request;
    }
    public VmSelection Select()
    {
        if (!Validation.Identifier(Id) || Directory != ExecutionFiles.Runtime(Id)
            || !FleetConfigurationContract.Absolute(Fleet) || ListenerPort is < 1 or > 65535)
            throw new IOException("Invalid VM supervisor identity, directory or listener port");
        PrivateFiles.ExistingDirectory(Directory, true);
        PrivateFiles.ExistingDirectory(Scratch, true);
        var loaded = ConfigurationFiles.Load(Fleet);
        if (!loaded.IsSuccess) throw new IOException(loaded.Error.Message);
        var configuration = loaded.Value;
        if (configuration.Digest != Digest) throw new IOException("Fleet configuration changed before VM admission; refresh before retrying");
        var instance = configuration.Roster.Instances.SingleOrDefault(instance => instance.Key == Instance)
            ?? throw new IOException("VM request does not select a fleet instance");
        if (instance.Execution.Kind != ExecutionKind.Vm || configuration.Execution is not { } catalog
            || instance.Execution.Image is not { } imageName || !catalog.Images.TryGetValue(imageName, out var image)
            || instance.Execution.Profile is not { } profileName || !catalog.Profiles.TryGetValue(profileName, out var profile))
            throw new IOException("Instance does not select a current fleet VM image and profile");
        var state = Path.Combine(Fleet, instance.Workarea); var workspace = instance.Workspace ?? state;
        var runtime = configuration.Definitions[instance.Definition].Runtime;
        var home = runtime switch { "codex" => ".codex", "pi" => ".pi", _ => throw new IOException("Unsupported native VM runtime") };
        if (Native.Directory != NativeOwnershipFiles.ForState(state) || Native.Workspace != workspace
            || !FleetConfigurationContract.Absolute(Native.StateDirectory)
            || Native.StateDirectory.Any(char.IsControl)
            || Native.StateDirectory != state && !Native.StateDirectory.StartsWith(state + "/", StringComparison.Ordinal)
            || Native.Home != Path.Combine(Native.StateDirectory, home))
            throw new IOException("VM request differs from the instance's exact native workspace and state ownership");
        PrivateFiles.ExistingDirectory(state, true); PrivateFiles.ExistingDirectory(Native.StateDirectory, true);
        var userHome = Environment.GetEnvironmentVariable("HOME") ?? throw new IOException("Native execution requires HOME");
        var protectedRoots = configuration.Roster.Instances.Where(peer => peer.Key != Instance)
            .Select(peer => Path.Combine(Fleet, peer.Workarea))
            .Concat(catalog.Images.Values.Select(value => value.Path))
            .Concat(new[] { Path.GetDirectoryName(Directory)!, ExecutionFiles.CacheRoot, Path.Combine(Fleet, ".fleet"), Path.Combine(Authentication.Root, "ctlflow"),
                Environment.GetEnvironmentVariable("CODEX_HOME") ?? Path.Combine(userHome, ".codex"),
                Environment.GetEnvironmentVariable("PI_CODING_AGENT_DIR") ?? Path.Combine(userHome, ".pi"),
                Path.Combine(userHome, ".ssh"), Path.Combine(userHome, ".secrets") }).Distinct(StringComparer.Ordinal).ToArray();
        var planned = VmExports.Plan(state, workspace, Native.Directory, protectedRoots, profile.Mounts);
        if (!planned.IsSuccess) throw new IOException(planned.Error.Message);
        foreach (var mount in planned.Value)
        {
            PrivateFiles.ExistingDirectory(mount.Path, false);
            if (!mount.ReadOnly) PrivateFiles.OwnedDirectory(mount.Path, allowGroupWrite: true);
        }
        return new(catalog, image, profile, planned.Value);
    }
}

public sealed record VmSelection(ExecutionCatalog Catalog, VmImage Image, VmProfile Profile, IReadOnlyList<VmMount> Mounts);
