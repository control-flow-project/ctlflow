using System.Reflection;
using System.Text.Json;
using Crossfire.AdapterToml;
using Crossfire.Kernel;
using Fleetd.Contracts;
using Fleetd.Domain;

namespace Fleetd.Storage.Tests;

internal static class ExecutionConfigurationAcceptance
{
    internal static void Run(Action<bool, string> check)
    {
        if (!OperatingSystem.IsLinux()) throw new PlatformNotSupportedException("Fleet execution acceptance requires Linux");
        using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("Fleetd.ExecutionSelectionCases")
            ?? throw new InvalidOperationException("Shared execution selection cases are missing");
        using var document = JsonDocument.Parse(stream);
        foreach (var sample in document.RootElement.EnumerateArray())
        {
            var roster = FleetConfigurationContract.Roster(sample.GetProperty("roster"));
            var source = sample.GetProperty("catalog");
            var catalog = source.ValueKind == JsonValueKind.Null ? Result<ExecutionCatalog?>.Success(null)
                : ExecutionContract.Catalog(source).Map<ExecutionCatalog?>(value => value);
            var valid = roster.IsSuccess && catalog.IsSuccess
                && ExecutionContract.Validate(roster.Value.Instances.Select(instance => instance.Execution), catalog.Value).IsSuccess;
            check(valid == sample.GetProperty("valid").GetBoolean(), "Fleet execution selection: " + sample.GetProperty("name").GetString());
        }
        var directory = Path.Combine(Path.GetTempPath(), "fleet-vm-configuration-" + Guid.NewGuid());
        Directory.CreateDirectory(directory);
        File.SetUnixFileMode(directory, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
        try
        {
            var sample = document.RootElement.EnumerateArray().First(sample => sample.GetProperty("name").GetString() == "fleet-approved VM");
            Directory.CreateDirectory(Path.Combine(directory, "agents"), UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute | UnixFileMode.GroupRead | UnixFileMode.GroupExecute | UnixFileMode.OtherRead | UnixFileMode.OtherExecute);
            var role = Path.Combine(directory, "agents", "research"); Directory.CreateDirectory(role, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute | UnixFileMode.GroupRead | UnixFileMode.GroupExecute | UnixFileMode.OtherRead | UnixFileMode.OtherExecute);
            File.WriteAllText(Path.Combine(role, "agent.toml"), "name=\"Research\"\nruntime=\"codex\"\n[runtime_options]\n");
            File.WriteAllText(Path.Combine(role, "AGENTS.md"), "Fixture instructions.");
            File.WriteAllText(Path.Combine(directory, "runtime.toml"), TomlJson.Format(sample.GetProperty("roster")).Value);
            foreach (var file in new[] { "runtime.toml", "agents/research/agent.toml", "agents/research/AGENTS.md" })
                File.SetUnixFileMode(Path.Combine(directory, file), UnixFileMode.UserRead | UnixFileMode.UserWrite);
            check(!ConfigurationFiles.Load(directory).IsSuccess, "VM without catalog never becomes host execution");
            var catalog = TomlJson.Format(sample.GetProperty("catalog")).Value;
            File.WriteAllText(Path.Combine(directory, "execution.toml"), catalog);
            File.SetUnixFileMode(Path.Combine(directory, "execution.toml"), UnixFileMode.UserRead | UnixFileMode.UserWrite);
            var first = ConfigurationFiles.Load(directory);
            check(first.IsSuccess, "Fleet loader admits its exact image/profile definitions" + (first.IsSuccess ? "" : ": " + first.Error.Message));
            if (!first.IsSuccess) return;
            check(first.Value.Roster.Instances[0].Execution == new ExecutionPlacement(ExecutionKind.Vm, "python", "research"), "Fleet loader retains VM selection");
            check(first.Value.Execution?.Profiles["research"].MemoryMiB == 512, "Fleet loader retains memory units");
            var rewritten = ConfigurationFiles.WriteRoster(first.Value, first.Value.Roster);
            check(rewritten.IsSuccess && rewritten.Value.Roster.Instances[0].Execution == first.Value.Roster.Instances[0].Execution,
                "Editing the roster retains VM execution and its catalog");
            File.WriteAllText(Path.Combine(directory, "execution.toml"), catalog.Replace("1024", "1536", StringComparison.Ordinal));
            var changed = ConfigurationFiles.Load(directory);
            check(changed.IsSuccess && rewritten.IsSuccess && changed.Value.Digest != rewritten.Value.Digest, "Catalog changes invalidate the previous fleet revision");
            check(rewritten.IsSuccess && !ConfigurationFiles.WriteRoster(rewritten.Value, rewritten.Value.Roster).IsSuccess, "Stale configuration cannot overwrite a catalog edit");
        }
        finally { Directory.Delete(directory, recursive: true); }
    }
}
