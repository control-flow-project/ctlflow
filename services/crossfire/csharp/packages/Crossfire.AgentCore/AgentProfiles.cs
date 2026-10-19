using System.Text.Json;
using Crossfire.Contracts;
using Crossfire.Domain;
using Crossfire.Kernel;

namespace Crossfire.AgentCore;

public static class AgentProfiles
{
    public static JsonElement Encode(AgentProfile profile) => WireJson.Object(writer =>
    {
        writer.WriteString("id", profile.Id); writer.WriteString("workspace", profile.Workspace);
        writer.WriteStartObject("account"); writer.WriteString("userId", profile.Account.UserId); writer.WriteString("accessToken", profile.Account.AccessToken);
        writer.WritePropertyName("native"); profile.Account.Native.WriteTo(writer); writer.WriteEndObject();
        writer.WriteStartObject("settings"); writer.WriteString("instance", profile.Settings.Instance); writer.WriteString("server", profile.Settings.Server);
        writer.WriteStartObject("backend"); writer.WriteString("type", profile.Settings.Backend.Type); writer.WritePropertyName("parameters"); profile.Settings.Backend.Parameters.WriteTo(writer); writer.WriteEndObject();
        writer.WriteString("owner", profile.Settings.Owner); writer.WriteNumber("maxUploadBytes", profile.Settings.MaxUploadBytes); writer.WriteEndObject();
    });
    public static Result<AgentProfile> Parse(JsonElement value)
    {
        if (!Validation.Fields(value, ["id", "workspace", "account", "settings"]).IsSuccess) return Invalid();
        var account = value.GetProperty("account"); var settings = value.GetProperty("settings");
        if (!Validation.Fields(account, ["userId", "accessToken", "native"]).IsSuccess
            || !Validation.Fields(settings, ["instance", "server", "backend", "owner", "maxUploadBytes"]).IsSuccess) return Invalid();
        var backend = settings.GetProperty("backend");
        if (!Validation.Fields(backend, ["type", "parameters"]).IsSuccess) return Invalid();
        var id = WireJson.Text(value, "id"); var workspace = WireJson.Text(value, "workspace"); var user = WireJson.Text(account, "userId");
        var token = Validation.Text(account.GetProperty("accessToken"), 8192); var instance = Validation.Text(settings.GetProperty("instance"), 100);
        var server = WireJson.Text(settings, "server"); var owner = WireJson.Text(settings, "owner"); var type = Validation.Text(backend.GetProperty("type"), 100);
        var maximum = Validation.Integer(settings.GetProperty("maxUploadBytes"), 1, 16777216);
        if (id is null || !Validation.Identifier(id) || workspace is null || !Path.IsPathFullyQualified(workspace) || user is null || !Validation.UserId(user)
            || !token.IsSuccess || !BackendData.Valid(account.GetProperty("native")) || !instance.IsSuccess || !IdentitySyntax.Name(instance.Value) || server is null || !Validation.Origin(server).IsSuccess
            || !type.IsSuccess || !IdentitySyntax.Name(type.Value) || !BackendData.Valid(backend.GetProperty("parameters")) || owner is null || !Validation.UserId(owner) || !maximum.IsSuccess) return Invalid();
        return Result<AgentProfile>.Success(new(new(instance.Value, server, new(type.Value, backend.GetProperty("parameters").Clone()), owner, (int)maximum.Value),
            workspace, id, new(user, token.Value, account.GetProperty("native").Clone())));
    }
    private static Result<AgentProfile> Invalid() => Results.Fail<AgentProfile>("invalid", "Invalid project-local agent profile");
}
