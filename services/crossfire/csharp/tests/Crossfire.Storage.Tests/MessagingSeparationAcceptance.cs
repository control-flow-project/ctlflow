using Crossfire.AdapterSqlite;
using Crossfire.Domain;
using Crossfire.Kernel;
using static Crossfire.Storage.Tests.Checks;

namespace Crossfire.Storage.Tests;

public static class MessagingSeparationAcceptance
{
    public static async Task Verify(CrossfireDbContext context, Actor owner, long now)
    {
        var agent = FleetFixture.Create(context, owner, now);
        const string room = "control";
        var nativeAccess = WireJson.Object(writer => { writer.WriteStartArray("roles"); writer.WriteStringValue("reviewer"); writer.WriteEndArray(); writer.WriteStartObject("scope"); writer.WriteString("project", "credit"); writer.WriteEndObject(); });
        var account = MessagingFixture.Ports().AgentAccount("agent/東京", "test-token");
        Equal(account.UserId, "agent/東京", "backend accounts retain opaque identity without native grammar");
        var member = new RoomMembership(account.UserId, "Independent agent", "leave", null);
        RoomFacts Facts(string user) => new(room, "Independent room", "", null, user, true, ["read", "reply", "custom"], "opaque-revision", [], [new("invite-collaborator", "Invite a collaborator", true)]);
        var messaging = MessagingFixture.Ports() with
        {
            Room = (user, _, _, _) => ValueTask.FromResult(Result<RoomFacts>.Success(Facts(user))),
            AuthorizeRoomAccess = (user, _, selected, intent, _) =>
            {
                Equal(selected == room && BackendData.Equal(intent.NativeAccess, nativeAccess), true, "authority receives neutral room and opaque access intent");
                return ValueTask.FromResult(Result<RoomFacts>.Success(Facts(user)));
            },
            Membership = (_, _, _, _) => ValueTask.FromResult(Result<RoomMembership>.Success(member)),
            SetRoomAccess = (_, user, selected, intent, admission, _) =>
            {
                Equal(selected == room && admission?.Kind == "managed", true, "generic reconciliation passes explicit admission to its backend");
                member = new(user, "Independent agent", "join", intent.NativeAccess); return ValueTask.FromResult(Result<RoomMembership>.Success(member));
            }
        };
        var grants = RoomGrantCommands.Ports(context, () => now, messaging);
        var changed = await RoomGrantChanges.Change(grants, owner, new(agent.AgentId, room, 0, null, "custom", nativeAccess, false), Identity.Identifier());
        Equal(changed.IsSuccess, true, "generic grants accept non-native-shaped rooms and role objects");
        var ports = new RoomReconcilePorts(grants, messaging, () => PolicyQueries.Find(context),
            id => AuthorizationQueries.AgentView(context, id).Map(value => value?.Application), (_, operation, cancellation) => operation(cancellation));
        Equal((await RoomReconciliation.Reconcile(ports, agent.AgentId, room)).IsSuccess, true, "generic reconciliation does not interpret backend roles");
        var applied = RoomGrantQueries.Application(context, agent.AgentId, room).Value!;
        Equal(applied.Membership, "join", "backend membership is recorded through its neutral port");
        Equal(BackendData.Equal(applied.NativeAccess, nativeAccess), true, "opaque backend authority survives persistence unchanged");
    }
}
