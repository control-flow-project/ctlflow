using System.Reflection;
using System.Text;
using System.Text.Json;
using Crossfire.AdapterFilesystem;
using Crossfire.AdapterToml;
using Crossfire.Kernel;
using Fleetd.AdapterExecution.Vm;
using Fleetd.Storage;

internal static class RequestAcceptance
{
    internal static void Run(string root, Action<bool, string> check)
    {
        using var cases = JsonDocument.Parse(Assembly.GetExecutingAssembly().GetManifestResourceStream("Fleetd.ExecutionSelectionCases")
            ?? throw new IOException("Missing shared execution fixture"));
        var sample = cases.RootElement.EnumerateArray().Single(value => value.GetProperty("name").GetString() == "fleet-approved VM");
        var fleet = PrivateFiles.Directory(Path.Combine(root, "request-fleet"));
        var role = PrivateFiles.Directory(Path.Combine(fleet, "agents", "research"));
        void Write(string path, string text) => PrivateFiles.Write(path, Encoding.UTF8.GetBytes(text), 65536);
        Write(Path.Combine(role, "agent.toml"), "name=\"Research\"\nruntime=\"codex\"\n[runtime_options]\n");
        Write(Path.Combine(role, "AGENTS.md"), "Only the request test fixture.");
        Write(Path.Combine(fleet, "runtime.toml"), TomlJson.Format(sample.GetProperty("roster")).Value);
        Write(Path.Combine(fleet, "execution.toml"), TomlJson.Format(sample.GetProperty("catalog")).Value);
        var configuration = ConfigurationFiles.Load(fleet); if (!configuration.IsSuccess) throw new IOException(configuration.Error.Message);
        var instance = configuration.Value.Roster.Instances.Single(); var state = PrivateFiles.Directory(Path.Combine(fleet, instance.Workarea));
        var id = Identity.Identifier(); ExecutionFiles.Create(id); var control = ExecutionFiles.Runtime(id);
        try
        {
            var request = new VmRequest(id, control, fleet, instance.Key, configuration.Value.Digest,
                new(NativeOwnershipFiles.ForState(state), state, state, Path.Combine(state, ".codex")), null);
            request.Write(); var loaded = VmRequest.Read(request.File); var selection = loaded.Select();
            check(loaded == request && selection.Mounts.Count == 1 && selection.Mounts[0].Path == state && !selection.Mounts[0].ReadOnly,
                "Current supervisor request round-trips and exports exactly its instance state");
            foreach (var invalid in new[] {
                request with { Digest = "changed" }, request with { Instance = "missing" }, request with { ListenerPort = 0 },
                request with { Directory = root },
                request with { Native = request.Native with { Directory = state } },
                request with { Native = request.Native with { Workspace = root } },
                request with { Native = request.Native with { StateDirectory = root, Home = Path.Combine(root, ".codex") } },
                request with { Native = request.Native with { Home = Path.Combine(state, ".other") } } })
            {
                var rejected = false; try { invalid.Select(); } catch (IOException) { rejected = true; }
                check(rejected, "Forged, stale or mismatched supervisor request is rejected before native ownership");
            }
            var before = Directory.GetFileSystemEntries(control).Length;
            _ = Placement.Create(configuration.Value, instance, null);
            check(Directory.GetFileSystemEntries(control).Length == before && !File.Exists(request.Ready),
                "Constructing a VM-selected runtime factory starts no helper or guest");
            var json = Encoding.UTF8.GetString(PrivateFiles.Read(request.File, 32768));
            Write(request.File, json[..^1] + ",\"extra\":true}");
            var rejectedExtra = false; try { VmRequest.Read(request.File); } catch (IOException) { rejectedExtra = true; }
            check(rejectedExtra, "Supervisor rejects fields outside the single current request schema");
            Write(Path.Combine(role, "agent.toml"), "name=\"Research\"\nruntime=\"pi\"\n[runtime_options]\n");
            var pi = ConfigurationFiles.Load(fleet); if (!pi.IsSuccess) throw new IOException(pi.Error.Message);
            var piRequest = request with { Digest = pi.Value.Digest, Native = request.Native with { Home = Path.Combine(state, ".pi") } };
            check(piRequest.Select().Mounts.Single().Path == state, "Pi selects the same exact approved state export and its own native home");
            var rejectedHome = false;
            try { (piRequest with { Native = request.Native }).Select(); } catch (IOException) { rejectedHome = true; }
            check(rejectedHome, "Pi cannot select the Codex home as a second native state path");
        }
        finally { ExecutionFiles.Remove(id); }
    }
}
