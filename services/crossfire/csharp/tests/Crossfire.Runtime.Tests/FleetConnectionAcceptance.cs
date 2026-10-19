using System.Text.Json;
using Crossfire.AdapterCrossfire;
using Crossfire.AgentCore;
using Crossfire.Kernel;
using static Crossfire.Runtime.Tests.Checks;

namespace Crossfire.Runtime.Tests;

public static class FleetConnectionAcceptance
{
    public static async Task Verify()
    {
        var fleet = Identity.Identifier(); var agent = Identity.Identifier(); var message = Identity.Identifier();
        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var polling = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var clock = new ManualTime(); using var lifetime = new CancellationTokenSource();
        var revision = 1; var enabled = true; var polls = 0; var holdReceipt = true;
        JsonElement Snapshot(bool full) => WireJson.Object(writer =>
        {
            writer.WriteString("fleetId", fleet); writer.WriteNumber("revision", revision); writer.WriteBoolean("deliveryEnabled", enabled);
            writer.WriteStartObject("connection"); writer.WriteString("status", "online"); writer.WriteNumber("lastSeenAt", 0); writer.WriteEndObject();
            if (full) { writer.WriteStartArray("agentIds"); writer.WriteStringValue(agent); writer.WriteEndArray(); writer.WriteStartArray("messages"); writer.WriteEndArray(); writer.WriteStartArray("runtimeOperations"); writer.WriteEndArray(); }
        });
        var coordination = new Coordination("https://fixture.invalid", async (request, cancellation) =>
        {
            if (request.Operation == "reportFleetConnection") return Result<JsonElement>.Success(Snapshot(false));
            if (request.Operation == "fleetControl")
            {
                if (++polls > 1) { polling.TrySetResult(); await Task.Delay(Timeout.InfiniteTimeSpan, cancellation); }
                return Result<JsonElement>.Success(Snapshot(true));
            }
            if (request.Operation == "changeFleetDelivery")
            { enabled = request.Body!.Value.GetProperty("enabled").GetBoolean(); revision++; return Result<JsonElement>.Success(Snapshot(false)); }
            if (request.Operation == "acknowledgeFleetMessage")
            {
                if (holdReceipt)
                {
                    entered.TrySetResult(); try { await Task.Delay(Timeout.InfiniteTimeSpan, cancellation); } catch (OperationCanceledException) { }
                    return Results.Fail<JsonElement>("unavailable", "Fixture receipt transport cancelled");
                }
                return Result<JsonElement>.Success(WireJson.Object(writer => writer.WriteBoolean("recorded", true)));
            }
            return Results.Fail<JsonElement>("invalid", "Unexpected fixture operation");
        });
        await using var connection = new FleetConnection(coordination, fleet, "private-fixture", "owner", clock,
            (_, _) => ValueTask.FromResult(Results.Fail<RemoteRuntimeOutcome>("invalid", "No native operation was requested")), _ => Results.Done(), lifetime.Token);
        await polling.Task.WaitAsync(TimeSpan.FromSeconds(5));
        var listener = connection.Bind(agent); var original = listener.Current();
        Equal(original.Active, true, "The fixture begins with authenticated delivery");
        var receipt = listener.Acknowledge("fleet-" + message + "-" + agent, "delivered", null, original.Generation).AsTask();
        await entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
        Equal((await connection.Delivery(1, false, lifetime.Token)).IsSuccess, true, "Delivery pause reaches the controller");
        try { await receipt; } catch (OperationCanceledException) { }
        Equal(original.Generation.IsCancellationRequested, true, "Delivery pause cancels the in-flight message receipt");
        Equal(connection.Status.Connected, true, "A cancelled message receipt cannot disconnect authenticated reporting");
        Equal(original.ConnectionGeneration.IsCancellationRequested, false, "A pending native question retains its reporting generation");
        Equal(listener.Current().ConnectionGeneration, original.ConnectionGeneration, "Delivery cancellation retains the exact reporting owner");
        holdReceipt = false;
        Equal((await listener.Acknowledge("fleet-" + message + "-" + agent, "delivered", null, lifetime.Token)).IsSuccess, true, "The same message receipt can be retried after cancellation");
        Equal(connection.Status.Connected, true, "Successful receipt retry retains the controller connection");
    }
}
