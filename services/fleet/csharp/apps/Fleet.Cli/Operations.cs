using System.Text.Json;
using Crossfire.AgentCore;
using Crossfire.AdapterCodex;
using Fleet.SshTransport;
using Client = Fleet.DaemonClient.DaemonClient;
using static Fleet.Cli.CommandValues;

namespace Fleet.Cli;

public static class Operations
{
    public static async ValueTask<JsonElement> Observe(Client client, JsonElement initial, TimeProvider clock, CancellationToken cancellation)
    {
        var operation = initial; var notified = "";
        for (;;)
        {
            cancellation.ThrowIfCancellationRequested(); var id = Text(operation, "operationId");
            if (operation.TryGetProperty("approval", out var approval) && approval.ValueKind == JsonValueKind.Object && Text(approval, "code") != notified) { Output(Object(writer => { writer.WriteString("status", "awaiting-approval"); foreach (var field in approval.EnumerateObject()) field.WriteTo(writer); })); notified = Text(approval, "code"); }
            var status = Text(operation, "status"); if (status == "succeeded") return operation; if (status == "failed") { Output(operation); throw new CommandFailure("Operation failed; successful peers and saved histories are retained. Inspect fleet show FLEET and retry explicitly."); }
            if (status is not ("accepted" or "running" or "awaiting-approval")) throw new CommandFailure("Invalid daemon operation status"); await Task.Delay(TimeSpan.FromMilliseconds(250), clock, cancellation); var observed = await Call(client, "operation", cancellation, parameters: new Dictionary<string, string> { ["operationId"] = id });
            if (!observed.IsSuccess) throw new CommandFailure(observed.Error.Message + "; the operation continues in fleetd. Retry with operation ID " + id); operation = observed.Value;
        }
    }
    public static async ValueTask Attach(Client client, IReadOnlyDictionary<string, string> parameters, string? context, string? host, CancellationToken cancellation)
    {
        var pointer = Value(await Call(client, "attachment", cancellation, parameters: parameters, query: context is null ? null : new Dictionary<string, string> { ["context"] = context })); var runtime = Text(pointer, "runtime"); if (runtime != "codex") throw new CommandFailure("No terminal adapter for runtime: " + runtime);
        var fields = pointer.GetProperty("connection"); if (fields.ValueKind != JsonValueKind.Object || fields.EnumerateObject().Any(value => value.Value.ValueKind != JsonValueKind.String)) throw new CommandFailure("Invalid native terminal connection");
        var attachment = new RuntimeAttachment(runtime, Text(pointer, "sessionId"), Text(pointer, "workspace"), fields.EnumerateObject().ToDictionary(value => value.Name, value => value.Value.GetString()!, StringComparer.Ordinal)); var command = Value(CodexTerminal.Create().Command(attachment)); Console.WriteLine(host is null ? command : SshTunnel.Terminal(host, command));
    }
}
