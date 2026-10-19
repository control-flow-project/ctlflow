using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Text.Json.Serialization;
using Crossfire.AdapterFilesystem;
using Crossfire.AdapterHttp;
using Crossfire.AdapterMatrix;
using Crossfire.Contracts;
using Crossfire.Kernel;
using static Crossfire.Storage.Tests.Checks;

namespace Crossfire.Storage.Tests;

public static class MatrixAcceptance
{
    public static async Task<bool> Run(string[] arguments)
    {
        if (arguments.Length != 2 || arguments[0] != "--matrix") return false;
        using var configuration = JsonDocument.Parse(PrivateFiles.Read(arguments[1], 16384));
        var values = configuration.RootElement;
        var origin = values.GetProperty("origin").GetString()!; var serverName = values.GetProperty("serverName").GetString()!;
        var owner = values.GetProperty("owner").GetString()!; var ownerToken = values.GetProperty("ownerToken").GetString()!;
        var agent = values.GetProperty("agent").GetString()!; var outsider = values.GetProperty("outsider").GetString()!;
        using var authority = new AccountAuthority(new(origin, serverName, values.GetProperty("jwtSecret").GetString()!,
            values.GetProperty("registrationSecret").GetString()!, owner));
        using var http = NativeHttp.Client();
        var ownerEndpoint = new NativeEndpoint(origin, ownerToken);
        async Task<JsonElement> Request(string method, string path, JsonElement? body = null)
        {
            var response = await MatrixJson.Ok(http, ownerEndpoint, method, MatrixJson.Api + path, body);
            Equal(response.IsSuccess, true, "real Conduit request " + path + (response.IsSuccess ? "" : ": " + response.Error.Message));
            return response.Value;
        }
        Equal((await authority.Identify(ownerToken)).Value, owner, "real Conduit native token identity");
        var account = await authority.Provision(agent, "private-native-verification-password");
        Equal(account.IsSuccess, true, "real Conduit agent provisioning");
        Equal((await authority.Identify(account.Value.AccessToken)).Value, agent, "real Conduit provisioned token identity");
        var reopened = await authority.Provision(agent, "private-native-verification-password");
        Equal(reopened.Value.UserId, agent, "repeat provisioning uses owned credentials");
        Equal((await authority.Identify(reopened.Value.AccessToken)).Value, agent, "latest native device credential remains valid");
        Equal((await authority.SetDisplayName(agent, "Native specialist (Native owner)")).IsSuccess, true, "real native agent display name");
        var conversation = await authority.OwnerConversation(owner, agent, null, null);
        Equal(conversation.IsSuccess, true, "real private owner DM creation" + (conversation.IsSuccess ? "" : ": " + conversation.Error.Message));
        var dm = conversation.Value;
        Equal((await authority.OwnerConversation(owner, agent, null, null)).Value, dm, "private owner DM discovered from native direct account data");
        Equal((await authority.Room(owner, dm, null)).Value.Name, "Native specialist (Native owner)", "owner conversation has meaningful display name");
        Equal((await authority.Membership(owner, agent, dm)).Value.Membership, "join", "agent joins private owner DM");
        Equal((await authority.Leave(agent, dm)).IsSuccess, true, "agent leaves native owner DM");
        Equal((await authority.OwnerConversation(owner, agent, dm, null)).Value, dm, "repair preserves exact owner DM identity");
        Equal((await authority.Membership(owner, agent, dm)).Value.Membership, "join", "owner DM repair restores expected membership");
        var created = await Request("POST", "/createRoom", MatrixJson.Object(writer =>
        {
            writer.WriteString("preset", "public_chat"); writer.WriteString("name", "Native shared room");
        }));
        var room = created.GetProperty("room_id").GetString()!;
        var granted = await authority.SetRoomAccess(owner, agent, room, new("read", null, false), new("managed"));
        Equal(granted.IsSuccess, true, "real native managed room admission" + (granted.IsSuccess ? "" : ": " + granted.Error.Message));
        Equal(granted.Value.Membership, "join", "managed native membership confirmed");
        Equal(granted.Value.NativeAccess!.Value.GetProperty("powerLevel").GetInt64(), -1L, "read-only native level confirmed");
        Equal((await authority.SetRoomAccess(owner, agent, room, new("reply", null, false), new("managed"))).Value.NativeAccess!.Value.GetProperty("powerLevel").GetInt64(), 0L, "native reply access upgrade");
        Equal((await authority.Leave(agent, room)).IsSuccess, true, "real shared-room departure");
        Equal((await authority.SetRoomAccess(owner, agent, room, new("reply", null, false), null)).Value.Membership, "leave", "ordinary reconciliation cannot readmit departed agent");
        async Task Invite() => _ = await Request("POST", "/rooms/" + MatrixJson.Segment(room) + "/invite", MatrixJson.Object(writer => writer.WriteString("user_id", agent)));
        await Invite();
        var invitation = await authority.Invitation(agent, room);
        Equal(invitation.IsSuccess, true, "real native invitation sync" + (invitation.IsSuccess ? "" : ": " + invitation.Error.Message));
        Equal(invitation.Value?.SenderBackendUserId, owner, "native invitation sender proof");
        var eventId = invitation.Value!.EventId;
        Equal((await authority.Leave(agent, room)).IsSuccess, true, "withdraw native invitation");
        Equal((await authority.SetRoomAccess(owner, agent, room, new("reply", null, false), new("invitation", eventId, owner))).Error.Code, "conflict",
            "withdrawn invitation cannot be accepted from old receipt");
        await Invite();
        var nextInvitation = await authority.Invitation(agent, room);
        Equal(nextInvitation.Value!.EventId != eventId, true, "new native invitation has exact new identity");
        Equal((await authority.SetRoomAccess(owner, agent, room, new("reply", null, false), new("invitation", nextInvitation.Value.EventId, owner))).Value.Membership,
            "join", "exact invitation admission verified against real Matrix");
        Equal((await authority.Invitation(agent, room)).Value is null, true, "incremental invitation cache removes joined rooms");
        var notice = await authority.SendNotice(owner, room, Identity.Identifier(), "Native delivery verified", agent);
        Equal(notice.IsSuccess, true, "real native notice publication");
        var read = await authority.Event(owner, room, notice.Value);
        Equal(read.Value.Control, true, "listener notice never becomes new agent control input");
        Equal(read.Value.Mentions.Single(), agent, "native explicit mention metadata preserved");
        Equal(read.Value.Body, "Native delivery verified", "native event body roundtrip");
        var quoted = await Request("PUT", "/rooms/" + MatrixJson.Segment(room) + "/send/m.room.message/" + Identity.Identifier(), MatrixJson.Object(writer =>
        {
            writer.WriteString("msgtype", "m.text"); writer.WriteString("body", agent + ": quoted name only");
        }));
        Equal((await authority.Event(owner, room, quoted.GetProperty("event_id").GetString()!)).Value.Mentions.Count, 0, "quoted names do not become directed controls");
        Equal((await authority.Joined(agent)).Value.Contains(room, StringComparer.Ordinal), true, "native joined-room inventory");
        await Request("POST", "/rooms/" + MatrixJson.Segment(dm) + "/invite", MatrixJson.Object(writer => writer.WriteString("user_id", outsider)));
        Equal((await authority.VerifyOwnerConversation(owner, agent, dm)).Error.Code, "forbidden", "third-party invitation invalidates private observation channel");
        Equal((await authority.Deactivate(owner)).Error.Code, "forbidden", "real control identity cannot deactivate itself");
        await NativeEnrollmentAcceptance.Verify(authority, values.GetProperty("database").GetString()!, owner, serverName);
        await ServerAcceptance.Verify(authority, values.GetProperty("database").GetString()!, values.GetProperty("releaseDirectory").GetString()!, owner, ownerToken, serverName, origin);
        Console.WriteLine(JsonSerializer.Serialize(new MatrixResult("passed", RuntimeFeature.IsDynamicCodeSupported, Checks.Passed), MatrixResultJson.Default.MatrixResult));
        return true;
    }
}

public sealed record MatrixResult(string Status, bool DynamicCode, int Assertions);
[JsonSerializable(typeof(MatrixResult))]
partial class MatrixResultJson : JsonSerializerContext;
