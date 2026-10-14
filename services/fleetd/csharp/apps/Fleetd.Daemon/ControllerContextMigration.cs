using Crossfire.AdapterCodex;
using Crossfire.AdapterFilesystem;
using Crossfire.Kernel;
using Fleetd.AdapterExecution;
using Fleetd.Storage;

namespace Fleetd.Daemon;

public static class ControllerContextMigration
{
    public static void Run(string root)
    {
        PrivateFiles.ExistingDirectory(root, true); using var controller = new StateLock(Path.Combine(root, "daemon")); var registry = new RegistryFiles(root); var registrations = Value(registry.Registrations()); var locks = new List<StateLock>(); var inputs = new List<(string Workspace, string State)>();
        try
        {
            foreach (var registration in registrations)
            {
                var configuration = Value(registry.Port.Load(registration.Directory)); foreach (var instance in configuration.Roster.Instances)
                {
                    if (configuration.Definitions[instance.Definition].Runtime != "codex") continue; var state = Path.Combine(configuration.Directory, instance.Workarea); if (!PrivateFiles.Exists(state)) continue; var local = AgentProjects.Paths(state, instance.Key); foreach (var name in new[] { "listener", "receiver" }) locks.Add(new(Path.Combine(local.State, name))); inputs.Add((instance.Workspace ?? state, state));
                }
            }
            var migrated = 0; var contexts = 0; foreach (var input in inputs) { var outcome = Value(ContextMigration.Run(input.Workspace, input.State)); if (outcome.Migrated) migrated++; contexts += outcome.Contexts; }
            Console.WriteLine(WireJson.Compact(WireJson.Object(writer => { writer.WriteString("status", "migrated"); writer.WriteNumber("inspected", inputs.Count); writer.WriteNumber("migrated", migrated); writer.WriteNumber("contexts", contexts); })));
        }
        finally { foreach (var ownership in Enumerable.Reverse(locks)) ownership.Dispose(); }
    }
    private static T Value<T>(Result<T> value) => value.IsSuccess ? value.Value : throw new InvalidDataException(value.Error.Message);
}
