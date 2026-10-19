using System.Text.Json;
using Crossfire.Domain;
using Crossfire.Kernel;

namespace Crossfire.Contracts;

public static class MessagingContract
{
    public static Result<JsonElement?> NativeAccess(JsonElement value) => value.ValueKind == JsonValueKind.Null ? Result<JsonElement?>.Success(null)
        : BackendData.Valid(value) ? Result<JsonElement?>.Success(value.Clone()) : Results.Fail<JsonElement?>("invalid", "Invalid native access parameters");
    public static Result<BackendConfiguration> Configuration(JsonElement value)
    {
        if (!Validation.Fields(value, ["type", "parameters"]).IsSuccess || WireJson.Text(value, "type") is not { } type
            || !IdentitySyntax.Name(type) || !BackendData.Valid(value.GetProperty("parameters")))
            return Results.Fail<BackendConfiguration>("invalid", "Invalid messaging backend configuration");
        return Result<BackendConfiguration>.Success(new(type, value.GetProperty("parameters").Clone()));
    }
    public static Result<BackendAccount> Account(JsonElement value)
    {
        if (!Validation.Fields(value, ["userId", "accessToken", "native"]).IsSuccess || WireJson.Text(value, "userId") is not { } user || !Validation.UserId(user)
            || !Validation.Text(value.GetProperty("accessToken"), 8192).IsSuccess || !BackendData.Valid(value.GetProperty("native")))
            return Results.Fail<BackendAccount>("invalid", "Invalid messaging account");
        return Result<BackendAccount>.Success(new(user, value.GetProperty("accessToken").GetString()!, value.GetProperty("native").Clone()));
    }
    public static JsonElement Account(BackendAccount account) => WireJson.Object(writer =>
    { writer.WriteString("userId", account.UserId); writer.WriteString("accessToken", account.AccessToken); writer.WritePropertyName("native"); account.Native.WriteTo(writer); });
}
