using System.Text.Json;
using Crossfire.Domain;
using Crossfire.Kernel;

namespace Crossfire.Server.Http;

public static class JsonValues
{
    public static JsonElement Object(Action<ProtocolWriter> write)
        => Value(writer => { writer.WriteStartObject(); write(writer); writer.WriteEndObject(); });

    public static JsonElement Value(Action<ProtocolWriter> write) => WireJson.Build(write);

    public static JsonElement Array<T>(IReadOnlyList<T> values, Action<ProtocolWriter, T> write)
        => Value(writer =>
        {
            writer.WriteStartArray(); foreach (var value in values) write(writer, value); writer.WriteEndArray();
        });

    public static JsonElement Accepted() => Object(writer => writer.WriteBoolean("accepted", true));
    public static JsonElement Recorded() => Object(writer => writer.WriteBoolean("recorded", true));
    public static Result<JsonElement> Acknowledge(Result<Unit> value) => value.Map(_ => Accepted());
    public static void Number(ProtocolWriter writer, string name, long? value)
    {
        if (value is null) writer.WriteNull(name); else writer.WriteNumber(name, value.Value);
    }
    public static void Strings(ProtocolWriter writer, string name, IReadOnlyList<string> values)
    {
        writer.WriteStartArray(name); foreach (var value in values) writer.WriteStringValue(value); writer.WriteEndArray();
    }
    public static void Application(ProtocolWriter writer, PrincipalApplication value)
    {
        writer.WriteStartObject("application"); Number(writer, "appliedRevision", value.AppliedRevision); writer.WriteString("appliedStatus", value.AppliedStatus);
        writer.WriteString("nativeDisplayName", value.NativeDisplayName); Number(writer, "lastAttemptAt", value.LastAttemptAt); Number(writer, "lastSuccessAt", value.LastSuccessAt);
        writer.WriteString("errorCode", value.ErrorCode); writer.WriteString("errorMessage", value.ErrorMessage); writer.WriteEndObject();
    }
    public static void Member(ProtocolWriter writer, MemberView value)
    {
        writer.WriteStartObject(); writer.WriteString("memberId", value.Principal.Id); writer.WriteString("matrixUserId", value.Principal.MatrixUserId);
        writer.WriteString("displayName", value.Member.DisplayName); writer.WriteString("roleCode", value.Role.RoleCode); writer.WriteString("status", value.Principal.Status);
        writer.WriteNumber("revision", value.Principal.Revision); writer.WriteNumber("createdAt", value.Principal.CreatedAt); Application(writer, value.Application); writer.WriteEndObject();
    }
}
