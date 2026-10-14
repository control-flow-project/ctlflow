using Crossfire.Domain;
using Crossfire.Kernel;
using Microsoft.EntityFrameworkCore;

namespace Crossfire.AdapterSqlite;

public static class RoomGrantCommands
{
    public static Result<Unit> Save(CrossfireDbContext context, RoomGrant grant, bool create)
    {
        var agentId = grant.AgentId; var roomId = grant.RoomId;
        if (!create)
        {
            var generation = grant.Generation; var authorizerId = grant.AuthorizerId; var addedById = grant.AddedById;
            var invitationEventId = grant.InvitationEventId; var admissionKind = grant.AdmissionKind; var accessMode = grant.AccessMode;
            var powerLevel = grant.PowerLevel; var muted = grant.Muted ? 1L : 0L; var revision = grant.Revision;
            var accessRevision = grant.AccessRevision; var updatedAt = grant.UpdatedAt;
            var affected = context.AgentRoomGrant.Where(row => row.AgentId == agentId && row.RoomId == roomId).ExecuteUpdate(setters => setters
                .SetProperty(row => row.Generation, generation).SetProperty(row => row.AuthorizerId, authorizerId).SetProperty(row => row.AddedById, addedById)
                .SetProperty(row => row.InvitationEventId, invitationEventId).SetProperty(row => row.AdmissionKind, admissionKind).SetProperty(row => row.AccessMode, accessMode)
                .SetProperty(row => row.PowerLevel, powerLevel).SetProperty(row => row.Muted, muted).SetProperty(row => row.Revision, revision)
                .SetProperty(row => row.AccessRevision, accessRevision).SetProperty(row => row.UpdatedAt, updatedAt));
            return affected == 1 ? Results.Done() : Results.Fail<Unit>("missing", "Room grant not found");
        }
        var row = new Entities.AgentRoomGrantRow { AgentId = agentId, RoomId = roomId };
        context.AgentRoomGrant.Add(row);
        row.Generation = grant.Generation; row.AuthorizerId = grant.AuthorizerId; row.AddedById = grant.AddedById;
        row.InvitationEventId = grant.InvitationEventId; row.AdmissionKind = grant.AdmissionKind; row.AccessMode = grant.AccessMode;
        row.PowerLevel = grant.PowerLevel; row.Muted = grant.Muted ? 1 : 0; row.Revision = grant.Revision;
        row.AccessRevision = grant.AccessRevision; row.UpdatedAt = grant.UpdatedAt;
        context.SaveChanges(); context.Entry(row).State = EntityState.Detached; return Results.Done();
    }

    public static Result<Unit> Application(CrossfireDbContext context, RoomGrantApplication value)
    {
        var agentId = value.AgentId; var roomId = value.RoomId;
        var row = context.RoomGrantApplication.SingleOrDefault(row => row.AgentId == agentId && row.RoomId == roomId);
        if (row is null)
        {
            row = new() { AgentId = agentId, RoomId = roomId };
            context.RoomGrantApplication.Add(row);
        }
        row.ObservedGeneration = value.ObservedGeneration; row.AppliedRevision = value.AppliedRevision; row.AppliedAccessRevision = value.AppliedAccessRevision;
        row.Membership = value.Membership; row.Creator = value.Creator ? 1 : 0; row.PowerLevel = value.PowerLevel;
        row.LastAttemptAt = value.LastAttemptAt; row.LastSuccessAt = value.LastSuccessAt; row.NextCheckAt = value.NextCheckAt;
        row.ErrorCode = value.ErrorCode; row.ErrorMessage = value.ErrorMessage;
        context.SaveChanges(); return Results.Done();
    }

    public static Result<Unit> Permissions(CrossfireDbContext context, string agentId, string roomId, IReadOnlyList<RoomPermission> permissions)
    {
        context.AgentRoomPermission.RemoveRange(context.AgentRoomPermission.Where(row => row.AgentId == agentId && row.RoomId == roomId).ToArray());
        context.SaveChanges();
        foreach (var value in permissions) context.AgentRoomPermission.Add(new() { AgentId = value.AgentId, RoomId = value.RoomId, Generation = value.Generation,
            PermissionCode = value.PermissionCode, GrantScope = value.GrantScope, GrantedByMemberId = value.GrantedByMemberId, GrantedAt = value.GrantedAt });
        context.SaveChanges(); return Results.Done();
    }

    public static Result<Unit> Revise(CrossfireDbContext context, string agentId, long revision)
    {
        context.Principal.Single(row => row.Id == agentId).Revision = revision;
        context.SaveChanges(); return Results.Done();
    }

    public static RoomGrantPorts Ports(CrossfireDbContext context, Func<long> now,
        Func<string, string, CancellationToken, ValueTask<Result<RoomFacts>>> room)
        => new(AuthorizationQueries.Ports(context, now), new SqliteUnitOfWork(context),
            (agent, id) => RoomGrantQueries.Find(context, agent, id), agent => RoomGrantQueries.Grants(context, agent), (grant, create) => Save(context, grant, create),
            (agent, revision) => Revise(context, agent, revision), id => RoomGrantQueries.Private(context, id), agent => RoomGrantQueries.OwnerRoom(context, agent),
            (agent, id) => RoomGrantQueries.Permissions(context, agent, id), (agent, id, values) => Permissions(context, agent, id, values),
            agent => RoomGrantQueries.FleetPolicy(context, agent), (agent, id) => RoomGrantQueries.Application(context, agent, id), value => Application(context, value),
            room, intent => MemberCommands.Audit(context, intent, now), Identity.Identifier);
}
