using System.Text.Json;
using Fleet.SshTransport;
using Client = Fleet.DaemonClient.DaemonClient;
using static Fleet.Cli.CommandValues;

namespace Fleet.Cli;

public static class Commands
{
    public static async Task Run(string[] arguments, TimeProvider clock, CancellationToken cancellation)
    {
        var input = Parse(arguments); var words = input.Positionals; if (input.Has("help") || words.Count == 0) { Console.WriteLine(Usage); return; }
        if (words[0] == "setup") { if (words.Count != 1 || input.Has("remote")) throw new CommandFailure("Setup runs locally on the agent computer"); await Setup.Run(input, clock, cancellation); return; }
        var settings = Connections.Load();
        if (words[0] == "remote")
        {
            if (words.Count != 3 || words[1] != "add" || input.Option("ssh") is not { } ssh || input.Option("root") is not { } remoteRoot || !SshTunnel.ValidHost(ssh) || !Connections.ValidRemoteRoot(remoteRoot) || input.Has("remote")) throw new CommandFailure(Usage); var name = Name(words[2]); if (settings.Remotes.Any(value => value.Name == name)) throw new CommandFailure("Remote name already exists"); Connections.Save(settings with { Remotes = [.. settings.Remotes, new(name, ssh, remoteRoot)] }); Output(Object(writer => writer.WriteString("saved", name))); return;
        }
        if (input.Has("root") && input.Has("remote")) throw new CommandFailure("Select a local root or a remote, not both"); var remote = input.Option("remote") is { } selected ? settings.Remotes.FirstOrDefault(value => value.Name == selected) ?? throw new CommandFailure("Remote connection not found") : null;
        var root = remote?.Root ?? (input.Option("root") is { } local ? Path.GetFullPath(local) : settings.LocalRoot) ?? throw new CommandFailure("Select --root DIRECTORY or --remote NAME");
        if (words[0] == "daemon" && words.ElementAtOrDefault(1) == "start") { if (remote is not null || words.Count != 2) throw new CommandFailure("Start the controller locally on its computer"); var status = await DaemonLauncher.Launch(root, input.Option("name"), clock, cancellation); Connections.Save(settings with { LocalRoot = root }); Output(status); return; }
        if (words[0] == "start" && words.Count != 2 || words[0] == "agent" && words.ElementAtOrDefault(1) == "start" && words.Count != 4) throw new CommandFailure(Usage);
        if (remote is null && (words[0] == "start" || words[0] == "agent" && words.ElementAtOrDefault(1) == "start")) await DaemonLauncher.Launch(root, null, clock, cancellation);
        await using var tunnel = remote is null ? null : Value(await SshTunnel.Open(remote.Ssh, root, clock, cancellation)); using var client = new Client(tunnel?.Socket ?? Path.Combine(root, "fleetd.sock"));
        if (words[0] == "daemon")
        {
            if (words.Count != 2 || words[1] is not ("status" or "stop" or "restart")) throw new CommandFailure(Usage);
            if (words[1] == "restart") { if (remote is not null) throw new CommandFailure("Restart runs locally on the controller computer; use its installed fleet CLI over SSH"); Output(await DaemonLauncher.Restart(root, clock, cancellation)); }
            else Output(Value(await Call(client, words[1] == "status" ? "status" : "operate", cancellation, words[1] == "stop" ? DaemonLauncher.StopRequest() : null))); return;
        }
        if (words[0] == "add") { if (words.Count != 2) throw new CommandFailure(Usage); Output(Value(await Call(client, "addFleet", cancellation, Object(writer => writer.WriteString("directory", remote is null ? Path.GetFullPath(words[1]) : words[1]))))); return; }
        var fleets = await List(client, cancellation); if (words[0] == "list" && words.Count == 1) { Output(Wire(fleets)); return; }
        var agent = words[0] == "agent"; var command = words.ElementAtOrDefault(agent ? 1 : 0); var key = words.ElementAtOrDefault(agent ? 2 : 1); var fleet = fleets.FirstOrDefault(value => Text(value, "fleetKey") == key || Text(value, "fleetId") == key); if (fleet.ValueKind != JsonValueKind.Object) throw new CommandFailure("Fleet not found: " + key);
        var fleetId = Text(fleet, "fleetId"); var parameters = new Dictionary<string, string> { ["fleetId"] = fleetId }; var revision = Number(fleet, "revision");
        if (!agent && command is "activate" or "deactivate" && words.Count == 2)
        {
            var connection = fleet.GetProperty("connection"); if (!Boolean(connection, "connected") || connection.GetProperty("revision").ValueKind == JsonValueKind.Null) throw new CommandFailure("Fleet controller is not connected to Crossfire"); Output(Value(await Call(client, "changeFleetDelivery", cancellation, Object(writer => { writer.WriteNumber("expectedRevision", Number(connection, "revision")); writer.WriteBoolean("enabled", command == "activate"); }), parameters))); return;
        }
        if (!agent && command == "message" && words.Count == 2 && input.Option("text") is { } text) { var id = Identifier(input.Option("message-id")); Output(Object(writer => writer.WriteString("messageId", id))); Output(Value(await Call(client, "createFleetMessage", cancellation, Object(writer => { writer.WriteString("messageId", id); writer.WriteString("body", text); }), parameters))); return; }
        if (!agent && command == "show" && words.Count == 2) { Output(fleet); return; } if (!agent && command == "test" && words.Count == 2) { Output(Value(await Call(client, "readiness", cancellation, parameters: parameters))); return; }
        if (agent && command == "list" && words.Count == 3) { Output(fleet.GetProperty("instances")); return; } if (!agent && command == "remove" && words.Count == 2) { Output(Value(await Call(client, "removeFleet", cancellation, Revision(revision), parameters))); return; }
        if (words.Count != (agent ? 4 : 2)) throw new CommandFailure(Usage); var instance = agent ? Name(words[3]) : null;
        if (agent && command == "add") { var definition = Name(input.Option("definition")); Output(Value(await Call(client, "addAgent", cancellation, Object(writer => { writer.WriteNumber("expectedRevision", revision); writer.WriteStartObject("instance"); writer.WriteString("key", instance); writer.WriteString("name", instance); writer.WriteString("definition", definition); writer.WriteString("workarea", "agents/" + definition + "/workarea/" + instance); writer.WriteEndObject(); }), parameters))); return; }
        var agentParameters = new Dictionary<string, string>(parameters); if (instance is not null) agentParameters.Add("instanceKey", instance);
        if (agent && command == "remove") { Output(Value(await Call(client, "removeAgent", cancellation, Revision(revision), agentParameters))); return; }
        if (agent && command == "contexts") { Output(Value(await Call(client, "contexts", cancellation, parameters: agentParameters))); return; }
        if (agent && command == "attach") { await Operations.Attach(client, agentParameters, input.Option("context"), remote?.Ssh, cancellation); return; }
        if (command is not ("enroll" or "start" or "stop" or "update") || agent && command == "enroll") throw new CommandFailure(Usage);
        if (command == "update" && remote is not null && !input.Has("release-directory")) throw new CommandFailure("Remote update requires --release-directory on its controller computer");
        var operationId = Identifier(input.Option("operation-id")); var request = Object(writer => { writer.WriteString("operationId", operationId); writer.WriteString("action", input.Has("fresh-history") ? "reset" : command); writer.WriteNumber("expectedRevision", revision); writer.WriteStartObject("target"); writer.WriteString("kind", agent ? "agent" : "fleet"); writer.WriteString("fleetId", fleetId); if (agent) writer.WriteString("instanceKey", instance); writer.WriteEndObject(); if (command == "update") writer.WriteString("releaseDirectory", input.Option("release-directory") ?? DaemonLauncher.ReleaseDirectory); });
        Output(Object(writer => writer.WriteString("operationId", operationId))); Output(await Operations.Observe(client, Value(await Call(client, "operate", cancellation, request)), clock, cancellation));
    }
    private static JsonElement Revision(long revision) => Object(writer => writer.WriteNumber("expectedRevision", revision));
    private static JsonElement Wire(IReadOnlyList<JsonElement> values) => Crossfire.Kernel.WireJson.Array(writer => { foreach (var value in values) value.WriteTo(writer); });
    private static async ValueTask<IReadOnlyList<JsonElement>> List(Client client, CancellationToken cancellation)
    {
        var values = new List<JsonElement>(); var page = 1L;
        do { var result = Value(await Call(client, "fleets", cancellation, query: new Dictionary<string, string> { ["page"] = page.ToString(System.Globalization.CultureInfo.InvariantCulture), ["pageSize"] = "100" })); foreach (var value in result.GetProperty("items").EnumerateArray()) values.Add(value.Clone()); var pages = Number(result.GetProperty("meta"), "totalPages"); if (page >= pages) return values; page++; } while (page <= 100000); throw new CommandFailure("Fleet pagination exceeded its bound");
    }
}
