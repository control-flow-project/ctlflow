using System.Text;
using System.Text.Json;
using Crossfire.AdapterFilesystem;
using Crossfire.AdapterHttp;
using Crossfire.AdapterToml;
using Crossfire.Contracts;
using Crossfire.Domain;
using Fleetd.Contracts;
using Client = Fleet.DaemonClient.DaemonClient;
using static Fleet.Cli.CommandValues;

namespace Fleet.Cli;

public static class Setup
{
    private static string ConfiguredDescriptor(string file)
    {
        if (!Path.IsPathFullyQualified(file) || file != Path.GetFullPath(file) || Path.GetFileName(file) != "runtime.toml") throw new CommandFailure("Supply an exact absolute, non-symlink runtime.toml configuration"); var source = new UTF8Encoding(false, true).GetString(PrivateFiles.ReadConfiguration(file, 1048576)); var roster = Value(TomlJson.Parse(source).Bind(FleetConfigurationContract.Roster)); return Onboarding.DescriptorUrl(roster.Coordination.Server, roster.Coordination.Owner);
    }
    public static async ValueTask Run(Arguments options, TimeProvider clock, CancellationToken cancellation)
    {
        var workspace = PrivateFiles.OwnedDirectory(Path.GetFullPath(Directory.GetCurrentDirectory()), true); var previous = Connections.LoadProject(workspace); var configuration = options.Option("config") ?? previous?.Configuration;
        if (configuration is not null && !Path.IsPathFullyQualified(configuration)) throw new CommandFailure("--config requires an absolute runtime.toml path"); var descriptor = options.Option("descriptor") ?? (configuration is not null ? ConfiguredDescriptor(configuration) : previous?.Descriptor) ?? throw new CommandFailure("Use fleet setup --descriptor PERSONALIZED_SETUP_URL from Crossfire, or --config /absolute/runtime.toml");
        var connections = Connections.Load(); var root = options.Option("root") is { } selectedRoot ? Path.GetFullPath(selectedRoot) : previous?.Root ?? connections.LocalRoot ?? Path.Combine(Connections.Home, ".ctlflow", "controller");
        if (root == workspace || workspace.StartsWith(root + "/", StringComparison.Ordinal)) throw new CommandFailure("Controller state must be separate from and not contain the current project"); var record = new ProjectSetup(workspace, descriptor, root, configuration); if (previous is not null && previous != record) throw new CommandFailure("Project already has different saved setup authority; use its saved configuration rather than replacing identities");
        var verified = await FetchDescriptor(descriptor, cancellation); Connections.SaveProject(record); Output(Object(writer => { writer.WriteString("status", "starting-controller"); writer.WriteString("workspace", workspace); writer.WriteString("controllerRoot", root); writer.WriteString("server", verified.Server); writer.WriteString("owner", verified.OwnerBackendUserId); writer.WriteString("conversation", "New fleet-managed agent; this coding session remains independent"); }));
        var controller = await DaemonLauncher.Launch(root, null, clock, cancellation); Connections.Save(connections with { LocalRoot = root }); using var client = new Client(Path.Combine(root, "fleetd.sock")); var prepared = Value(await Call(client, "setup", cancellation, Object(writer => { writer.WritePropertyName("descriptor"); Onboarding.Descriptor(verified.Server, verified.OwnerBackendUserId, verified.PackageVersion, verified.Instructions).WriteTo(writer); writer.WriteString("workspace", workspace); if (configuration is not null) writer.WriteString("configuration", configuration); })));
        var fleet = prepared.GetProperty("fleet"); var fleetId = Text(fleet, "fleetId"); if (prepared.TryGetProperty("operation", out var operation) && operation.ValueKind == JsonValueKind.Object) { Output(Object(writer => { writer.WriteString("operationId", Text(operation, "operationId")); writer.WriteString("fleet", Text(fleet, "fleetKey")); })); await Operations.Observe(client, operation, clock, cancellation); }
        var parameters = new Dictionary<string, string> { ["fleetId"] = fleetId }; var stopped = Text(prepared, "status") == "stopped"; var current = Value(await Call(client, "fleet", cancellation, parameters: parameters));
        if (!stopped)
        {
            using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(65), clock); using var scope = CancellationTokenSource.CreateLinkedTokenSource(cancellation, deadline.Token);
            while (!Ready(current))
            {
                if (WireText(current, "error") is not null || current.GetProperty("instances").EnumerateArray().Any(value => Boolean(value, "desiredActive") && Text(value, "phase") == "failed")) throw new CommandFailure("Setup did not reach a ready binding; inspect fleet show " + Text(current, "fleetKey") + ". No model prompt was sent.");
                await Task.Delay(TimeSpan.FromMilliseconds(100), clock, scope.Token); current = Value(await Call(client, "fleet", scope.Token, parameters: parameters));
            }
            Value(await Call(client, "readiness", cancellation, parameters: parameters));
        }
        Output(Object(writer => { writer.WriteString("status", stopped ? "stopped" : "ready"); writer.WriteString("controller", Text(controller.GetProperty("controller"), "name")); writer.WriteString("fleet", Text(current, "fleetKey")); writer.WriteNumber("agentCount", current.GetProperty("instances").GetArrayLength()); writer.WriteString("histories", "retained"); writer.WriteString("message", stopped ? "Existing stop intent is preserved. Run fleet start " + Text(current, "fleetKey") + " when ready." : "Controller and agent bindings are ready; no rooms were created and no model prompt was sent."); }));
    }
    private static string? WireText(JsonElement value, string name) => Crossfire.Kernel.WireJson.Text(value, name);
    private static bool Ready(JsonElement fleet) => Boolean(fleet.GetProperty("connection"), "connected") && fleet.GetProperty("instances").EnumerateArray().All(value => !Boolean(value, "desiredActive") || WireText(value, "sessionId") is not null && Text(value, "phase") is "running" or "sleeping");
    private static async ValueTask<SetupDescriptor> FetchDescriptor(string address, CancellationToken cancellation)
    {
        if (!Uri.TryCreate(address, UriKind.Absolute, out var uri) || uri.UserInfo.Length != 0 || uri.Fragment.Length != 0 || uri.AbsolutePath != "/onboarding/setup.json")
            throw new CommandFailure("Use the personalized Crossfire setup descriptor URL");
        var origin = uri.GetLeftPart(UriPartial.Authority);
        Value(Validation.Origin(origin));
        var query = uri.Query.TrimStart('?').Split('&');
        const string ownerParameter = "ownerBackendUserId=";
        if (query.Length != 1 || !query[0].StartsWith(ownerParameter, StringComparison.Ordinal))
            throw new CommandFailure("Descriptor requires exactly one ownerBackendUserId");
        var owner = Uri.UnescapeDataString(query[0][ownerParameter.Length..].Replace('+', ' '));
        if (!Validation.UserId(owner)) throw new CommandFailure("Invalid setup descriptor owner");
        using var http = NativeHttp.Client();
        using var response = Value(await NativeHttp.Json(http, new(origin, null, 30000), "GET", uri.PathAndQuery, maximumBytes: 262144, cancellation: cancellation));
        if (response.Status != 200 || response.ContentType != "application/json")
            throw new CommandFailure("Cannot read the trusted setup descriptor: HTTP " + response.Status);
        var descriptor = Value(Onboarding.ParseDescriptor(response.Body));
        if (descriptor.Server != origin || descriptor.OwnerBackendUserId != owner)
            throw new CommandFailure("Descriptor does not match its requested server and owner");
        var version = typeof(Setup).Assembly.GetName().Version?.ToString(3) ?? throw new CommandFailure("Installed package version is missing");
        if (descriptor.PackageVersion != version)
            throw new CommandFailure("Install exact Fleet release " + descriptor.PackageVersion + " from the setup guide, then rerun setup");
        return descriptor;
    }
}
