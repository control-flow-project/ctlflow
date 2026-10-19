using Crossfire.Domain;
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
        return policy.Value.AgentId == profile.Id && policy.Value.BackendUserId == profile.Account.UserId && policy.Value.OwnerBackendUserId == profile.Settings.Owner && policy.Value.Status == "active" && policy.Value.OwnerStatus == "active" ? policy : Results.Fail<ListenerPolicy>("forbidden", "Agent and owner must be active");
    }
    public static async ValueTask<Result<Unit>> Authorize(Coordination coordination, MessagingClient messaging, AgentProfile profile, CancellationToken cancellation)
    {
        var policy = await Policy(coordination, profile, cancellation); if (!policy.IsSuccess) return Result<Unit>.Fail(policy.Error); var room = policy.Value.OwnerConversation; if (room is null) return Results.Done();
        if (!policy.Value.Rooms.Any(grant => grant.RoomId == room && !grant.Muted && grant.AccessMode != "read")) return Results.Fail<Unit>("forbidden", "Owner conversation requires unmuted read and reply access");
        return await messaging.VerifyPrivateConversation(room, profile.Settings.Owner, profile.Account.UserId, cancellation);
    }
    public static async ValueTask<Result<string>> Conversation(Coordination coordination, MessagingClient messaging, AgentProfile profile, CancellationToken cancellation)
    {
        var conversation = await coordination.Agent("ownerConversation", profile.Id, null, cancellation); if (!conversation.IsSuccess) return Result<string>.Fail(conversation.Error);
        var room = WireJson.Text(conversation.Value, "roomId"); if (room is null || !Validation.RoomId(room)) return Results.Fail<string>("invalid", "Invalid owner conversation response");
        var authority = await Authorize(coordination, messaging, profile, cancellation); return authority.IsSuccess ? Result<string>.Success(room) : Result<string>.Fail(authority.Error);
    }
}
