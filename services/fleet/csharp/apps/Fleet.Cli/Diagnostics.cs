using System.Text.Json;
using Crossfire.Contracts;
using Crossfire.Kernel;
using Fleet.SshTransport;
using Client = Fleet.DaemonClient.DaemonClient;
using static Fleet.Cli.CommandValues;

namespace Fleet.Cli;

public static class Diagnostics
{
    public static async Task Run(string root, RemoteConnection? remote, IReadOnlyList<string> words, TimeProvider clock, CancellationToken cancellation)
    {
        var agent = words[0] == "agent";
        if (agent ? words.Count != 4 : words.Count > 2) throw new CommandFailure(Usage);
        var key = words.ElementAtOrDefault(agent ? 2 : 1); var instance = agent ? Name(words[3]) : null;
        if (key is not null && !IdentitySyntax.Name(key) && !Validation.Identifier(key)) throw new CommandFailure("Use a configured fleet key or UUID");
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(30), clock); using var scope = CancellationTokenSource.CreateLinkedTokenSource(cancellation, deadline.Token);
        var checkedAt = clock.GetUtcNow().ToUnixTimeMilliseconds(); SshTunnel? tunnel = null;
        JsonElement report;
        try
        {
            if (remote is not null)
            {
                var opened = await SshTunnel.Open(remote.Ssh, root, clock, scope.Token);
                if (!opened.IsSuccess) { Finish(Unavailable(checkedAt, false)); return; }
                tunnel = opened.Value;
            }
            using var client = new Client(tunnel?.Socket ?? Path.Combine(root, "fleetd.sock"), tunnel is null ? null : () => tunnel.AuthenticationKey);
            var controller = await Call(client, "diagnostics", scope.Token);
            if (!controller.IsSuccess) { Finish(Unavailable(checkedAt, controller.Error.Code is "unauthorized" or "forbidden")); return; }
            if (key is null) report = controller.Value;
            else
            {
                IReadOnlyList<JsonElement> fleets;
                try { fleets = await Commands.List(client, scope.Token); } catch (CommandFailure) { Finish(Unavailable(checkedAt, false)); return; }
                var fleet = fleets.FirstOrDefault(value => Text(value, "fleetKey") == key || Text(value, "fleetId") == key);
                if (fleet.ValueKind != JsonValueKind.Object) throw new CommandFailure("Fleet not found: " + key);
                var query = new Dictionary<string, string> { ["fleetId"] = Text(fleet, "fleetId") }; if (instance is not null) query.Add("instanceKey", instance);
                var result = await Call(client, "diagnostics", scope.Token, query: query);
                if (!result.IsSuccess && result.Error.Code is "unavailable" or "unauthorized" or "forbidden") report = Unavailable(checkedAt, result.Error.Code != "unavailable");
                else report = Value(result);
            }
        }
        finally { if (tunnel is not null) await tunnel.DisposeAsync(); }
        Finish(report);
    }
    private static void Finish(JsonElement report)
    {
        Output(report);
        if (report.GetProperty("checks").EnumerateArray().Any(check => Text(check, "status") == "fail")) throw new CommandFailure("Diagnostics found failed checks");
    }
    private static JsonElement Unavailable(long checkedAt, bool authentication) => Object(writer =>
    {
        writer.WriteNumber("checkedAt", checkedAt); writer.WritePropertyName("scope"); Scope(writer); writer.WriteStartArray("checks");
        Check("controller.connection", authentication ? "unknown" : "fail", checkedAt,
            authentication ? "Controller diagnostics require the mandatory authentication key" : "Selected controller API is unreachable; its cause and native process state are unknown",
            authentication ? "Check the shared private fleetd authentication configuration; diagnostics never creates or replaces it" : "Check the selected computer, controller process and socket; start fleetd explicitly if stopped");
        Check("controller.authentication", authentication ? "fail" : "unknown", authentication ? checkedAt : null, authentication ? "Authentication could not be read or was refused" : "Controller authentication could not be verified", null);
        Check("fleet.state", "unknown", null, "Fleet and native state cannot be inspected without the authenticated controller", null); writer.WriteEndArray();
        void Check(string id, string status, long? observedAt, string message, string? remediation)
        {
            writer.WriteStartObject(); writer.WriteString("id", id); writer.WritePropertyName("scope"); Scope(writer); writer.WriteString("status", status);
            if (observedAt is { } at) writer.WriteNumber("observedAt", at); else writer.WriteNull("observedAt");
            writer.WriteString("message", message); writer.WriteString("remediation", remediation); writer.WriteEndObject();
        }
    });
    private static void Scope(ProtocolWriter writer) { writer.WriteStartObject(); writer.WriteNull("fleetId"); writer.WriteNull("instanceKey"); writer.WriteEndObject(); }
}
