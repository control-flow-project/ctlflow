using Crossfire.AdapterSqlite;
using Crossfire.Domain;
using Crossfire.Kernel;
using Microsoft.EntityFrameworkCore;
using static Crossfire.Storage.Tests.Checks;

namespace Crossfire.Storage.Tests;

public static class RoomGrantAcceptance
{
    public static async Task Verify(CrossfireDbContext context, Actor owner, Actor administrator, long now)
    {
        var inviter = FleetFixture.Create(context, owner, now);
        var target = FleetFixture.Create(context, owner, now);
        var other = FleetFixture.Create(context, owner, now);
        const string roomId = "!grant-native:example.test";
        var nativeCalls = 0;
        var facts = new RoomFacts(roomId, "Native room", "", null, ((NativeAuthentication)owner.Authentication!).MatrixUserId,
            false, 50, [], -1, 0, 0, 50, 50, [new("m.room.message", 0)]);
        var ports = RoomGrantCommands.Ports(context, () => now, (matrixId, id, cancellation) =>
        {
            Equal(context.Database.CurrentTransaction is null, true, "native grant authority read is outside storage transaction");
            nativeCalls++;
            return ValueTask.FromResult(Result<RoomFacts>.Success(facts with { MatrixUserId = matrixId, RoomId = id }));
        });
        var initial = new GrantChange(inviter.AgentId, roomId, 0, null, "reply", null, false);
        var created = await RoomGrantChanges.Change(ports, owner, initial, Identity.Identifier());
        Equal(created.IsSuccess, true, "owner grants room reply access");
        Equal(created.Value.Revision, 1L, "grant and agent revision atomic");
        Equal(created.Value.Grant!.AccessRevision, 0L, "first grant access revision");
        Equal(RoomGrantQueries.Application(context, inviter.AgentId, roomId).Value?.NextCheckAt, now, "native enforcement queued after grant");
        var generation = created.Value.Grant.Generation;
        Equal((await RoomGrantChanges.Change(ports, owner, initial, Identity.Identifier())).Error.Code, "conflict", "stale agent revision rejects grant change");
        var repeated = initial with { ExpectedRevision = 1, ExpectedGeneration = generation };
        Equal((await RoomGrantChanges.Change(ports, owner, repeated, Identity.Identifier())).Value.Revision, 1L, "unchanged room grant does not revise agent");
        Equal(nativeCalls, 1, "unchanged managed room access does not reread native power");
        Equal((await RoomGrantChanges.Change(ports, inviter.Actor, new(target.AgentId, roomId, 0, null, "reply", null, false), Identity.Identifier())).Error.Code,
            "forbidden", "agent invitation requires explicit room permission");
        Equal(RoomPermissions.Set(ports, owner, inviter.AgentId, roomId, 1, generation, ["room.agent.invite"], Identity.Identifier()).Value, 2L,
            "owner delegates one generation-bound invitation permission");
        Equal(RoomPermissions.Set(ports, inviter.Actor, inviter.AgentId, roomId, 2, generation, [], Identity.Identifier()).Error.Code,
            "forbidden", "agent cannot redelegate invitation authority");
        Equal((await RoomGrantChanges.Change(ports, inviter.Actor, new(inviter.AgentId, roomId, 2, generation, "reply", null, false), Identity.Identifier())).Error.Code,
            "forbidden", "agent cannot grant itself access");
        var invited = await RoomGrantChanges.Change(ports, inviter.Actor, new(target.AgentId, roomId, 0, null, "reply", null, false), Identity.Identifier(),
            new(roomId, ((NativeAuthentication)inviter.Actor.Authentication!).MatrixUserId, "$native-invite"));
        Equal(invited.IsSuccess, true, "agent admits invited target through canonical grant path");
        Equal(invited.Value.Grant!.AddedById, inviter.AgentId, "invitation admission retains adding agent provenance");
        Equal(invited.Value.Grant.AdmissionKind, "invitation", "native invitation admission type");
        Equal(invited.Value.Grant.InvitationEventId, "$native-invite", "native invitation ID retained");
        var targetGeneration = invited.Value.Grant.Generation;
        var proof = await RoomGrantAuthorization.Authorize(ports, inviter.Actor, new(target.AgentId, roomId, 1, targetGeneration, "reply", null, true));
        Equal(proof.IsSuccess, true, "agent can change its own admitted room participant");
        Equal(RoomPermissions.Set(ports, owner, inviter.AgentId, roomId, 2, generation, [], Identity.Identifier()).Value, 3L, "owner can revoke delegated authority");
        Equal(RoomGrantAuthorization.Recheck(ports, inviter.Actor, proof.Value).Error.Code, "conflict", "authority revoked after native check rejects commit");
        Equal(RoomGrantQueries.Find(context, target.AgentId, roomId).Value?.Muted, false, "failed recheck leaves grant untouched");
        Equal(RoomPermissions.Set(ports, owner, inviter.AgentId, roomId, 3, generation, ["room.agent.invite"], Identity.Identifier()).Value, 4L, "owner reauthorizes same current generation");
        var otherGrant = await RoomGrantChanges.Change(ports, owner, new(other.AgentId, roomId, 0, null, "reply", null, false), Identity.Identifier());
        Equal((await RoomGrantChanges.Change(ports, inviter.Actor, new(other.AgentId, roomId, 1, otherGrant.Value.Grant!.Generation, "none", null, false), Identity.Identifier())).Error.Code,
            "forbidden", "agent cannot remove another inviter's participant");
        var removed = await RoomGrantChanges.Change(ports, inviter.Actor, new(target.AgentId, roomId, 1, targetGeneration, "none", null, false), Identity.Identifier());
        Equal(removed.Value.Grant!.AccessMode, "none", "agent can remove participant it admitted");
        Equal(removed.Value.Grant.Generation, targetGeneration, "withdrawn grant retains historical generation");
        Equal((await RoomGrantChanges.Change(ports, inviter.Actor, new(target.AgentId, roomId, 2, targetGeneration, "reply", null, false), Identity.Identifier(),
            new(roomId, ((NativeAuthentication)inviter.Actor.Authentication!).MatrixUserId, "$native-invite"))).Error.Code, "forbidden", "withdrawn native invitation cannot be replayed");
        var reinvited = await RoomGrantChanges.Change(ports, inviter.Actor, new(target.AgentId, roomId, 2, targetGeneration, "reply", null, false), Identity.Identifier(),
            new(roomId, ((NativeAuthentication)inviter.Actor.Authentication!).MatrixUserId, "$new-native-invite"));
        Equal(reinvited.Value.Grant!.Generation != targetGeneration, true, "new admission obtains fresh membership generation");
        Equal((await RoomGrantChanges.Change(ports, owner, new(target.AgentId, roomId, 3, reinvited.Value.Grant.Generation, "custom", 51, false), Identity.Identifier())).Error.Code,
            "forbidden", "requested native power cannot exceed authorizer ceiling");
        Equal((await RoomGrantChanges.Change(ports, owner, new(target.AgentId, roomId, 3, reinvited.Value.Grant.Generation, "reply", 5, false), Identity.Identifier())).Error.Code,
            "invalid", "noncustom grant cannot include custom level");
        facts = facts with { CreatorIds = [((NativeAuthentication)target.Actor.Authentication!).MatrixUserId] };
        Equal((await RoomGrantChanges.Change(ports, owner, new(target.AgentId, roomId, 3, reinvited.Value.Grant.Generation, "read", null, false), Identity.Identifier())).Error.Code,
            "forbidden", "native room creator cannot be artificially restricted");
        facts = facts with { CreatorIds = [] };
        var failing = ports with { Audit = _ => Results.Fail<Unit>("unavailable", "audit unavailable") };
        Equal((await RoomGrantChanges.Change(failing, owner, new(target.AgentId, roomId, 3, reinvited.Value.Grant.Generation, "read", null, false), Identity.Identifier())).Error.Code,
            "unavailable", "grant audit failure propagates");
        Equal(RoomGrantQueries.Find(context, target.AgentId, roomId).Value?.AccessMode, "reply", "failed grant audit rolls back flushed access");
        Equal(AuthorizationQueries.Principal(context, target.AgentId).Value?.Revision, 3L, "failed grant preserves revision");
        var privateId = "!owner-dm-native-" + target.AgentId + ":example.test";
        var ownDm = await RoomGrantChanges.Change(ports, owner, new(target.AgentId, privateId, 3, null, "reply", null, false), Identity.Identifier());
        Equal(ownDm.IsSuccess, true, "private owner conversation starts with reply grant");
        Equal(Transactions.Run(context, () =>
        {
            context.AgentOwnerConversation.Add(new() { AgentId = target.AgentId, OwnerId = owner.PrincipalId, RoomId = privateId, CreatedAt = now });
            return Results.Done();
        }).IsSuccess, true, "private owner conversation durable identity");
        Equal(RoomPermissions.Set(ports, owner, target.AgentId, privateId, 4, ownDm.Value.Grant!.Generation, ["room.agent.invite"], Identity.Identifier()).Error.Code,
            "forbidden", "owner DMs cannot delegate invitations");
        Equal((await RoomGrantChanges.Change(ports, administrator, new(target.AgentId, privateId, 4, ownDm.Value.Grant.Generation, "none", null, false), Identity.Identifier())).Error.Code,
            "forbidden", "owner DM cannot be removed even by administrator");
        Equal((await RoomGrantChanges.Change(ports, owner, new(other.AgentId, privateId, 1, null, "reply", null, false), Identity.Identifier())).Error.Code,
            "forbidden", "other agent cannot join private owner DM");
        var audit = context.AuditEvent.AsNoTracking().Where(row => row.RoomId == roomId && row.ActorPrincipalId == inviter.AgentId)
            .OrderByDescending(row => row.CreatedAt).First();
        Equal(audit.PermissionCode, "room.agent.invite", "invitation audit retains scoped permission");
        Equal(audit.AddedById, inviter.AgentId, "invitation audit retains adding principal");
        Equal(audit.MembershipGeneration is not null, true, "invitation audit retains exact generation");
    }
}
