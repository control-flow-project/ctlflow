using System.Text.Json;
using Crossfire.Contracts;
using Crossfire.Kernel;

namespace Crossfire.AgentCore;

public static class OwnerAuthority
{
    public static async ValueTask<Result<ListenerPolicy>> Policy(Coordination coordination, AgentProfile profile, CancellationToken cancellation)
    {
        var response = await coordination.Agent("deliveryPolicy", profile.Id, null, cancellation); if (!response.IsSuccess) return Result<ListenerPolicy>.Fail(response.Error);
        var policy = CoordinationValues.Policy(response.Value); if (!policy.IsSuccess) return policy;
        return policy.Value.AgentId == profile.Id && policy.Value.MatrixUserId == profile.Account.UserId && policy.Value.OwnerMatrixId == profile.Settings.Owner && policy.Value.Status == "active" && policy.Value.OwnerStatus == "active" ? policy : Results.Fail<ListenerPolicy>("forbidden", "Agent and owner must be active");
    }
    public static async ValueTask<Result<Unit>> Authorize(Coordination coordination, AgentMatrix matrix, AgentProfile profile, CancellationToken cancellation)
    {
        var policy = await Policy(coordination, profile, cancellation); if (!policy.IsSuccess) return Result<Unit>.Fail(policy.Error); var room = policy.Value.OwnerConversation; if (room is null) return Results.Done();
        if (!policy.Value.Rooms.Any(grant => grant.RoomId == room && !grant.Muted && grant.AccessMode != "read")) return Results.Fail<Unit>("forbidden", "Owner conversation requires unmuted read and reply access");
        var response = await AgentIO.Request(matrix, new("GET", AgentWire.Room(room) + "/state"), cancellation); if (!response.IsSuccess) return Result<Unit>.Fail(response.Error);
        var state = RoomState.Parse(response.Value); if (!state.IsSuccess) return Result<Unit>.Fail(state.Error); var privacy = RoomState.OwnerConversation(state.Value, profile.Settings.Owner, profile.Account.UserId); if (!privacy.IsSuccess) return privacy;
        if (new[] { profile.Settings.Owner, profile.Account.UserId }.Any(identity => !state.Value.Any(value => value.Type == "m.room.member" && value.StateKey == identity && WireJson.Text(value.Content, "membership") == "join"))) return Results.Fail<Unit>("forbidden", "Both participants must have joined the owner conversation");
        var powers = RoomState.Powers(RoomState.Content(state.Value, "m.room.power_levels") ?? WireJson.Object(_ => { }), profile.Account.UserId);
        return powers.IsSuccess && powers.Value.OwnerLevel >= powers.Value.Message ? Results.Done() : Results.Fail<Unit>("forbidden", "Agent cannot send the decision to its owner");
    }
    public static async ValueTask<Result<string>> Conversation(Coordination coordination, AgentMatrix matrix, AgentProfile profile, CancellationToken cancellation)
    {
        var conversation = await coordination.Agent("ownerConversation", profile.Id, null, cancellation); if (!conversation.IsSuccess) return Result<string>.Fail(conversation.Error);
        var room = WireJson.Text(conversation.Value, "roomId"); if (room is null || !Validation.RoomId(room)) return Results.Fail<string>("invalid", "Invalid owner conversation response");
        var authority = await Authorize(coordination, matrix, profile, cancellation); return authority.IsSuccess ? Result<string>.Success(room) : Result<string>.Fail(authority.Error);
    }
}
