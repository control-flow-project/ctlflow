using System.Text.Json;
using Crossfire.Contracts;
using Crossfire.Kernel;

namespace Crossfire.AgentCore;

public static class AgentProfiles
{
    public static JsonElement Encode(AgentProfile profile) => WireJson.Object(writer =>
    {
        writer.WriteString("id", profile.Id); writer.WriteString("workspace", profile.Workspace); writer.WriteStartObject("account"); writer.WriteString("user_id", profile.Account.UserId); writer.WriteString("access_token", profile.Account.AccessToken); writer.WriteString("device_id", profile.Account.DeviceId); writer.WriteEndObject(); writer.WriteStartObject("settings"); writer.WriteString("instance", profile.Settings.Instance); writer.WriteString("homeserver", profile.Settings.Homeserver); writer.WriteString("server_name", profile.Settings.ServerName); writer.WriteString("owner", profile.Settings.Owner); writer.WriteNumber("max_upload_bytes", profile.Settings.MaxUploadBytes); writer.WriteEndObject();
    });
    public static Result<AgentProfile> Parse(JsonElement value)
    {
        if (!Validation.Fields(value, ["id", "workspace", "account", "settings"]).IsSuccess || !Validation.Fields(value.GetProperty("account"), ["user_id", "access_token", "device_id"]).IsSuccess || !Validation.Fields(value.GetProperty("settings"), ["instance", "homeserver", "server_name", "owner", "max_upload_bytes"]).IsSuccess) return Results.Fail<AgentProfile>("invalid", "Invalid project-local agent profile");
        var id = WireJson.Text(value, "id"); var workspace = WireJson.Text(value, "workspace"); var account = value.GetProperty("account"); var user = WireJson.Text(account, "user_id"); var token = Validation.Text(account.GetProperty("access_token"), 8192); var device = Validation.Text(account.GetProperty("device_id"), 255); var settings = value.GetProperty("settings"); var instance = Validation.Text(settings.GetProperty("instance"), 100); var server = WireJson.Text(settings, "homeserver"); var serverName = Validation.Text(settings.GetProperty("server_name"), 255); var owner = WireJson.Text(settings, "owner"); var maximum = Validation.Integer(settings.GetProperty("max_upload_bytes"), 1, 16777216);
        return id is not null && Validation.Identifier(id) && workspace is not null && Path.IsPathFullyQualified(workspace) && user is not null && Validation.UserId(user) && token.IsSuccess && device.IsSuccess && instance.IsSuccess && server is not null && Validation.Origin(server).IsSuccess && serverName.IsSuccess && owner is not null && Validation.UserId(owner) && maximum.IsSuccess ? Result<AgentProfile>.Success(new(new(instance.Value, server, serverName.Value, owner, (int)maximum.Value), workspace, id, new(user, token.Value, device.Value))) : Results.Fail<AgentProfile>("invalid", "Invalid agent account, workspace or instance settings");
    }
}
