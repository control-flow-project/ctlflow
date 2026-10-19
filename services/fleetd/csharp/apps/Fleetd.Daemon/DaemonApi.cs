using System.Text.Json;
using Crossfire.AdapterHttp;
using Crossfire.AgentCore;
using Crossfire.Contracts;
using Crossfire.Kernel;
using Fleetd.Contracts;
using Fleetd.Domain;
using Fleetd.Storage;

namespace Fleetd.Daemon;

public sealed record DaemonReply(JsonElement Data, ResponseMetadata? Pagination = null);
public static class DaemonApi
{
    private sealed class RequestFailure(Failure error) : Exception(error.Message) { public Failure Error { get; } = error; }
    private static T Value<T>(Result<T> result) => result.IsSuccess ? result.Value : throw new RequestFailure(result.Error);
    private static void Fields(JsonElement value, params string[] names) => Value(Validation.Fields(value, names));
    private static string Text(JsonElement value, string name, int maximum = 4096) => Value(Validation.Text(value.GetProperty(name), maximum));
    private static long Revision(JsonElement value) => Value(Validation.Integer(value.GetProperty("expectedRevision")));
    public static async Task Handle(FleetController controller, string authenticationKey, Func<(int Days, string? Error)> logging, Action stopped, HttpContext http)
    {
        var id = Identity.Identifier(); RestOperation? operation = null; Result<DaemonReply> result;
        try
        {
            if (http.Request.Host.Value != "localhost" || http.Request.Headers.ContainsKey("Origin") || http.Request.Headers.ContainsKey("Cookie")) throw new RequestFailure(new("forbidden", "Use the private controller socket without browser credentials"));
            if (http.Request.Headers.Authorization.Count != 1 || !Authentication.Matches(http.Request.Headers.Authorization[0], authenticationKey)) throw new RequestFailure(new("unauthorized", "Valid fleetd authentication is required"));
            var path = http.Request.Path.Value ?? "/"; var matches = DaemonOperations.All.Values.Select(operation => (Operation: operation, Parameters: Match(operation.Path, path))).Where(value => value.Parameters is not null).ToArray();
            var selected = matches.FirstOrDefault(value => value.Operation.Method == http.Request.Method); operation = selected.Operation; if (operation is null) throw new RequestFailure(new(matches.Length == 0 ? "missing" : "method_not_allowed", "No such daemon operation"));
            foreach (var parameter in selected.Parameters!) if (parameter.Key is "fleetId" or "operationId" ? !Validation.Identifier(parameter.Value) : !IdentitySyntax.Name(parameter.Value)) throw new RequestFailure(new("invalid", "Invalid daemon path identity"));
            var query = new Dictionary<string, string>(StringComparer.Ordinal); foreach (var entry in http.Request.Query) { if (entry.Value.Count != 1) throw new RequestFailure(new("invalid", "Duplicated daemon query parameter")); query.Add(entry.Key, entry.Value[0]!); }
            var allowed = operation.Collection ? new[] { "page", "pageSize" } : operation.Name == "attachment" ? ["context"] : operation.Name == "diagnostics" ? ["fleetId", "instanceKey"] : Array.Empty<string>(); if (query.Keys.Any(key => !allowed.Contains(key, StringComparer.Ordinal))) throw new RequestFailure(new("invalid", "Unknown daemon query parameter"));
            var body = Value(await NativeHttp.Collect(http.Request.Body, 1048576, http.RequestAborted)); if (body.Length != 0 && http.Request.ContentType?.Split(';')[0] != "application/json") throw new RequestFailure(new("invalid", "Use application/json"));
            var input = body.Length == 0 ? WireJson.Object(_ => { }) : WireJson.Parse(body); var data = await Invoke(controller, operation.Name, selected.Parameters!, query, input, logging, id, http.RequestAborted); result = Result<DaemonReply>.Success(data);
        }
        catch (RequestFailure error) { result = Result<DaemonReply>.Fail(error.Error); }
        catch (Exception error) when (error is JsonException or IOException or InvalidDataException or InvalidOperationException or ArgumentException or OperationCanceledException or OverflowException or KeyNotFoundException or AggregateException)
        { result = Results.Fail<DaemonReply>(error is JsonException or ArgumentException or KeyNotFoundException ? "invalid" : "unavailable", "Daemon operation did not complete: " + error.Message); }
        var bytes = result.IsSuccess ? JsonSerializer.SerializeToUtf8Bytes(new ApiResponse(result.Value.Data, result.Value.Pagination ?? new(id)), ApiJson.Default.ApiResponse) : JsonSerializer.SerializeToUtf8Bytes(new ApiFailure(new(result.Error.Code, result.Error.Message, result.Error.FieldErrors), new(id)), ApiJson.Default.ApiFailure);
        if (bytes.Length > 16777216) { result = Results.Fail<DaemonReply>("unavailable", "Daemon response exceeds its finite output bound"); bytes = JsonSerializer.SerializeToUtf8Bytes(new ApiFailure(new(result.Error.Code, result.Error.Message), new(id)), ApiJson.Default.ApiFailure); }
        http.Response.StatusCode = result.IsSuccess ? operation!.Status : ApiErrors.Status(result.Error.Code); http.Response.ContentType = "application/json; charset=utf-8"; http.Response.Headers.CacheControl = "no-store"; http.Response.Headers.XContentTypeOptions = "nosniff"; http.Response.ContentLength = bytes.Length;
        if (controller.Stopping) http.Response.OnCompleted(() => { stopped(); return Task.CompletedTask; }); await http.Response.Body.WriteAsync(bytes, http.RequestAborted);
    }
    private static IReadOnlyDictionary<string, string>? Match(string template, string path)
    {
        var expected = template.Split('/'); var actual = path.Split('/'); if (expected.Length != actual.Length) return null; var values = new Dictionary<string, string>(StringComparer.Ordinal);
        for (var index = 0; index < expected.Length; index++) { var field = expected[index]; if (!field.StartsWith('{')) { if (field != actual[index]) return null; } else values.Add(field[1..^1], actual[index]); } return values;
    }
    private static DaemonReply Page(IReadOnlyList<JsonElement> items, IReadOnlyDictionary<string, string> query, string id)
    {
        var bounds = Value(Pagination.Parse(query)); var page = bounds.Page; var size = bounds.PageSize;
        return new(WireJson.Array(writer => { foreach (var item in items.Skip((page - 1) * size).Take(size)) item.WriteTo(writer); }), new(id, page, size, items.Count, Math.Max(1, (items.Count + size - 1) / size)));
    }
    private static async ValueTask<DaemonReply> Invoke(FleetController controller, string operation, IReadOnlyDictionary<string, string> parameters, IReadOnlyDictionary<string, string> query, JsonElement input, Func<(int Days, string? Error)> logging, string requestId, CancellationToken cancellation)
    {
        var fleet = parameters.GetValueOrDefault("fleetId") ?? ""; var instance = parameters.GetValueOrDefault("instanceKey") ?? "";
        switch (operation)
        {
            case "diagnostics":
                Fields(input); var report = Value(await controller.Diagnostics(Value(DiagnosticContract.Query(query)), cancellation)); var diagnosticLog = logging();
                return new(DiagnosticContract.Encode(report with { Checks = [.. report.Checks, new("controller.logging", new(null, null), diagnosticLog.Error is null ? "pass" : "fail", report.CheckedAt,
                    diagnosticLog.Error is null ? "Controller logging is available" : "Controller logging has failed", diagnosticLog.Error is null ? null : "Check disk space and controller log permissions")] }));
            case "status": Fields(input); var log = logging(); return new(WireJson.Object(writer => { writer.WritePropertyName("controller"); FleetWire.Controller(controller.Identity).WriteTo(writer); writer.WriteNumber("startedAt", controller.StartedAt); writer.WriteBoolean("stopping", controller.Stopping); writer.WriteNumber("loggingRetentionDays", log.Days); writer.WriteString("loggingError", log.Error); }));
            case "setup":
                Value(Validation.Fields(input, ["descriptor", "workspace"], ["configuration"])); var descriptor = Value(Onboarding.ParseDescriptor(input.GetProperty("descriptor"))); var configuration = input.TryGetProperty("configuration", out var configured) ? Value(Validation.Text(configured, 4096)) : null; var setup = Value(await controller.Setup(new(descriptor, Text(input, "workspace"), configuration), cancellation));
                return new(WireJson.Object(writer => { writer.WritePropertyName("fleet"); FleetWire.State(setup.Fleet).WriteTo(writer); writer.WritePropertyName("operation"); if (setup.Operation is null) writer.WriteNullValue(); else FleetWire.Operation(setup.Operation).WriteTo(writer); writer.WriteString("status", setup.Status); }));
            case "fleets": Fields(input); return Page(Value(controller.List()).Select(FleetWire.State).ToArray(), query, requestId);
            case "addFleet": Fields(input, "directory"); return new(FleetWire.State(Value(controller.Add(Text(input, "directory")))));
            case "fleet": Fields(input); return new(FleetWire.State(Value(controller.View(fleet))));
            case "readiness": Fields(input); Value(await controller.Test(fleet, cancellation)); return new(WireJson.Object(writer => writer.WriteBoolean("accepted", true)));
            case "changeFleet": Fields(input, "expectedRevision", "label"); return new(FleetWire.State(Value(controller.Rename(fleet, Revision(input), Text(input, "label", 100)))));
            case "removeFleet": Fields(input, "expectedRevision"); Value(await controller.Remove(fleet, Revision(input), cancellation)); return new(WireJson.Object(writer => writer.WriteBoolean("accepted", true)));
            case "changeFleetDelivery": Fields(input, "expectedRevision", "enabled"); return new(Value(await controller.Delivery(fleet, Revision(input), Value(Validation.Boolean(input.GetProperty("enabled"))), cancellation)));
            case "createFleetMessage": Fields(input, "messageId", "body"); var message = Text(input, "messageId"); if (!Validation.Identifier(message)) throw new RequestFailure(new("invalid", "Invalid fleet message identity")); var body = Value(Validation.PlainText(input.GetProperty("body"), 16384)); if (string.IsNullOrWhiteSpace(body) || body.Length > 4096) throw new RequestFailure(new("invalid", "Expected a fleet message of 1–4096 characters")); return new(Value(await controller.Message(fleet, message, body, cancellation)));
            case "agents": Fields(input); return Page(Value(controller.View(fleet)).Instances.Select(FleetWire.InstanceState).ToArray(), query, requestId);
            case "agent": Fields(input); var selected = Value(controller.View(fleet)).Instances.FirstOrDefault(value => value.Instance.Key == instance); return selected is null ? throw new RequestFailure(new("missing", "Instance not found")) : new(FleetWire.InstanceState(selected));
            case "contexts": Fields(input); return new(WireJson.Array(writer => { foreach (var value in Value(controller.Contexts(fleet, instance))) { writer.WriteStartObject(); writer.WriteString("context", value.Context); writer.WriteString("runtime", value.Runtime); writer.WriteString("sessionId", value.SessionId); writer.WriteEndObject(); } }));
            case "attachment": Fields(input); var pointer = Value(await controller.Attachment(fleet, instance, query.GetValueOrDefault("context"))); return new(WireJson.Object(writer => { writer.WriteString("runtime", pointer.Runtime); writer.WriteString("sessionId", pointer.SessionId); writer.WriteString("workspace", pointer.Workspace); writer.WriteStartObject("connection"); foreach (var pair in pointer.Connection) writer.WriteString(pair.Key, pair.Value); writer.WriteEndObject(); }));
            case "addAgent": Fields(input, "expectedRevision", "instance"); var addition = Value(FleetConfigurationContract.Instance(input.GetProperty("instance"), false)); return new(FleetWire.State(Value(await controller.Edit(fleet, Revision(input), "add", addition, null, null, cancellation))));
            case "changeAgent": Fields(input, "expectedRevision", "definition"); var definition = Text(input, "definition", 40); if (!IdentitySyntax.Name(definition)) throw new RequestFailure(new("invalid", "Invalid definition name")); return new(FleetWire.State(Value(await controller.Edit(fleet, Revision(input), "definition", null, instance, definition, cancellation))));
            case "removeAgent": Fields(input, "expectedRevision"); return new(FleetWire.State(Value(await controller.Edit(fleet, Revision(input), "remove", null, instance, null, cancellation))));
            case "operate": return new(FleetWire.Operation(Value(await controller.Operate(Value(OperationContract.Request(input))))));
            case "operation": Fields(input); return new(FleetWire.Operation(Value(controller.Operation(parameters["operationId"]))));
            default: throw new RequestFailure(new("missing", "No such daemon operation"));
        }
    }
}
