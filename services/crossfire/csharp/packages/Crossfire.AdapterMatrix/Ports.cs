using Crossfire.Domain;
using Crossfire.Kernel;
using System.Text.Json;
using System.Text.RegularExpressions;
using Crossfire.AdapterHttp;

namespace Crossfire.AdapterMatrix;

public sealed partial class AccountAuthority
{
    public MessagingPorts Ports() => new(Describe, Authenticate, AgentUserId, () => configuration.ServiceBackendUserId, LocalLabel,
        RegistrationUserId, AgentAccount, Identify, Exists, Provision, Deactivate, Discard, ProfileName, SetDisplayName, Joined,
        OwnerConversation, VerifyOwnerConversation, MarkDirect, Room, Membership, Invitation, AuthorizeRoomAccess, SetRoomAccess, Leave, Event, SendNotice);

    public string AgentUserId(string agentId) => "@agent-" + agentId + ":" + configuration.ServerName;
    public static string LocalLabel(string userId) => userId[1..userId.IndexOf(':')];
    public static BackendAccount AgentAccount(string userId, string accessToken) => new(userId, accessToken, WireJson.Object(writer => writer.WriteString("deviceId", "CROSSFIRE_AGENT")));
    public BackendDescription Describe(string publicOrigin) => new("matrix", "Matrix", publicOrigin + "/", publicOrigin + "/#/register",
        ["Continue to Element and choose your username and password.", "Select “Start authentication” and confirm the invitation in the window it opens.", "Return to Element to finish signing up."],
        new("matrix", WireJson.Object(writer => { writer.WriteString("origin", publicOrigin); writer.WriteString("serverName", configuration.ServerName); })));
    public Result<string> RegistrationUserId(MemberSignup input)
    {
        if (!SignupName().IsMatch(input.Username) || input.Username.StartsWith("agent-", StringComparison.Ordinal) || input.Password.Length is < 12 or > 1024
            || !BackendData.Valid(input.Native) || input.Native.EnumerateObject().Any(property => property.Name != "deviceId")
            || input.Native.TryGetProperty("deviceId", out var device) && (device.ValueKind != JsonValueKind.String || device.GetString()!.Length is < 1 or > 100))
            return Results.Fail<string>("invalid", "Choose a valid Matrix username and a password of at least 12 characters");
        var identity = "@" + input.Username + ":" + configuration.ServerName;
        return identity == configuration.ServiceBackendUserId || input.Username == "conduit" ? Results.Fail<string>("forbidden", "Reserved Matrix identity") : Result<string>.Success(identity);
    }
    public async ValueTask<Result<string>> Authenticate(string username, string password, CancellationToken cancellation = default)
    {
        var body = WireJson.Object(writer =>
        {
            writer.WriteString("type", "m.login.password"); writer.WriteStartObject("identifier"); writer.WriteString("type", "m.id.user"); writer.WriteString("user", username); writer.WriteEndObject();
            writer.WriteString("password", password); writer.WriteString("initial_device_display_name", "crossfire management");
        });
        var result = await NativeHttp.Json(client, Server(), "POST", MatrixJson.Api + "/login", body, cancellation: cancellation);
        if (!result.IsSuccess) return Result<string>.Fail(result.Error);
        using var response = result.Value;
        var token = WireJson.Text(response.Body, "access_token");
        return response.Status == 200 && token is { Length: > 0 and <= 8192 } ? Result<string>.Success(token) : Results.Fail<string>("unauthorized", "Messaging account sign-in failed");
    }
    [GeneratedRegex("\\A[a-z0-9][a-z0-9._=\\-]{0,99}\\z", RegexOptions.CultureInvariant)]
    private static partial Regex SignupName();

    public ValueTask<Result<Unit>> RoomOperation(string roomId, Func<CancellationToken, ValueTask<Result<Unit>>> operation, CancellationToken cancellation = default)
        => Exclusive("room:" + roomId, operation, cancellation);
}
