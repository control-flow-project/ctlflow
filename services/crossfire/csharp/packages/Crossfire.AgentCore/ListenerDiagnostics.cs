using System.Text.Json;
using Crossfire.Kernel;

namespace Crossfire.AgentCore;

public sealed partial class ListenerReceiver
{
    private ValueTask<Result<JsonElement>> Diagnose(CancellationToken cancellation) => AgentIO.Boundary(async () =>
    {
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(30), options.Clock); using var scope = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token, cancellation, deadline.Token);
        var authorized = await OwnerAuthority.Authorize(options.Coordination, options.Messaging, options.Profile, scope.Token); if (!authorized.IsSuccess) return Result<JsonElement>.Fail(authorized.Error); var native = await Runtime.Inspect(); if (!native.IsSuccess) return Result<JsonElement>.Fail(native.Error);
        var policy = await OwnerAuthority.Policy(options.Coordination, options.Profile, scope.Token); if (!policy.IsSuccess) return Result<JsonElement>.Fail(policy.Error); var who = await options.Messaging.Identify(scope.Token); if (!who.IsSuccess) return Result<JsonElement>.Fail(who.Error);
        if (who.Value != options.Profile.Account.UserId) return Results.Fail<JsonElement>("forbidden", "Messaging authentication does not match this agent"); var joinedRooms = await ReceivePages.Joined(options.Messaging, scope.Token); if (!joinedRooms.IsSuccess) return Result<JsonElement>.Fail(joinedRooms.Error);
        var rooms = policy.Value.Rooms.Where(room => !room.Muted).ToArray(); if (rooms.Any(room => !joinedRooms.Value.Contains(room.RoomId))) return Results.Fail<JsonElement>("conflict", "Granted room access is not applied yet; refresh room access in management and test again");
        var release = await options.Coordination.Call(new("release", new Dictionary<string, string>()), scope.Token); if (!release.IsSuccess) return release; var current = WireJson.Text(release.Value, "release"); if (current is null) return Results.Fail<JsonElement>("invalid", "Invalid current release response");
        var paused = state.Paused || !options.Control.Current().Active; var waking = policy.Value.Senders.Count != 0;
        var message = paused ? "Listener is connected; delivery is paused." : rooms.Length == 0 ? "Listener is ready. No unmuted rooms are granted. The owner can open a DM or invite this agent in chat; native approvals open the private DM only when needed." : !waking ? "Listener is connected. Wake-up rules disable chat-triggered input; use the runtime directly or change the policy in management." : "Listener, exact runtime session, server authentication and room access are ready.";
        return Result<JsonElement>.Success(WireJson.Object(writer => { writer.WriteString("session", Runtime.SessionId); writer.WriteString("server", options.Coordination.Origin); writer.WriteBoolean("authenticated", true); writer.WriteNumber("rooms", rooms.Length); writer.WriteNumber("joinedRooms", joinedRooms.Value.Count); writer.WriteBoolean("canReceiveRoomTasks", rooms.Length > 0 && !paused && waking); writer.WriteString("wakeMode", policy.Value.WakeMode); writer.WriteBoolean("busy", native.Value); writer.WriteBoolean("deliveryPaused", paused); writer.WriteString("approval", Runtime.Approval.ToString().ToLowerInvariant()); writer.WriteString("currentRelease", current); writer.WriteString("message", message); }));
    });
}
