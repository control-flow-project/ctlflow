using Crossfire.Domain;
using Crossfire.Kernel;
using Microsoft.EntityFrameworkCore;

namespace Crossfire.AdapterSqlite;

public static class FleetMapQueries
{
    public static Result<FleetMapRelations> Relations(CrossfireDbContext context, IReadOnlyList<string> requested)
    {
        var ids = requested.ToArray();
        var grants = Stored.Read(() => context.AgentRoomGrant.AsNoTracking().Where(row => ids.Contains(row.AgentId)).OrderBy(row => row.AgentId).ThenBy(row => row.RoomId)
            .Select(row => new RoomGrant(row.AgentId, row.RoomId, row.Generation, row.AuthorizerId, row.AddedById, row.InvitationEventId, row.AdmissionKind, row.AccessMode, row.PowerLevel, row.Muted == 1, row.Revision, row.AccessRevision, row.UpdatedAt)).ToArray());
        if (!grants.IsSuccess) return Result<FleetMapRelations>.Fail(grants.Error);
        var applications = Stored.Read(() => context.RoomGrantApplication.AsNoTracking().Where(row => ids.Contains(row.AgentId)).OrderBy(row => row.AgentId).ThenBy(row => row.RoomId)
            .Select(row => new RoomGrantApplication(row.AgentId, row.RoomId, row.ObservedGeneration, row.AppliedRevision, row.AppliedAccessRevision, row.Membership, row.Creator == 1, row.PowerLevel, row.LastAttemptAt, row.LastSuccessAt, row.NextCheckAt, row.ErrorCode, row.ErrorMessage)).ToArray());
        if (!applications.IsSuccess) return Result<FleetMapRelations>.Fail(applications.Error);
        return Stored.Read(() => context.AgentWakeSender.AsNoTracking().Where(row => ids.Contains(row.AgentId)).OrderBy(row => row.AgentId).ThenBy(row => row.SenderPrincipalId)
            .Select(row => new AgentWakeSelection(row.AgentId, row.SenderPrincipalId, row.IncludeAgents == 1)).ToArray()).Map(values => new FleetMapRelations(grants.Value, applications.Value, values));
    }
}
