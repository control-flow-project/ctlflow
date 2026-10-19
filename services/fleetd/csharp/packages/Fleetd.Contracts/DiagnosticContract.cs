using System.Text.Json;
using Crossfire.AgentCore;
using Crossfire.Contracts;
using Crossfire.Kernel;
using Fleetd.Domain;

namespace Fleetd.Contracts;

public static class DiagnosticContract
{
    public static Result<DiagnosticScope> Query(IReadOnlyDictionary<string, string> query)
    {
        var fleet = query.GetValueOrDefault("fleetId"); var instance = query.GetValueOrDefault("instanceKey");
        if (query.Keys.Any(key => key is not ("fleetId" or "instanceKey")) || fleet is not null && !Validation.Identifier(fleet) || instance is not null && (!IdentitySyntax.Name(instance) || fleet is null))
            return Results.Fail<DiagnosticScope>("invalid", "Use one exact diagnostic scope; an instance requires a fleet");
        return Result<DiagnosticScope>.Success(new(fleet, instance));
    }
    public static JsonElement Encode(DiagnosticReport value) => WireJson.Object(writer =>
    {
        writer.WriteNumber("checkedAt", value.CheckedAt); writer.WritePropertyName("scope"); Scope(writer, value.Scope); writer.WriteStartArray("checks");
        foreach (var check in value.Checks)
        {
            writer.WriteStartObject(); writer.WriteString("id", check.Id); writer.WritePropertyName("scope"); Scope(writer, check.Scope);
            writer.WriteString("status", check.Status); AgentWire.Number(writer, "observedAt", check.ObservedAt); writer.WriteString("message", check.Message); writer.WriteString("remediation", check.Remediation); writer.WriteEndObject();
        }
        writer.WriteEndArray();
    });
    private static void Scope(ProtocolWriter writer, DiagnosticScope scope)
    { writer.WriteStartObject(); writer.WriteString("fleetId", scope.FleetId); writer.WriteString("instanceKey", scope.InstanceKey); writer.WriteEndObject(); }
}
