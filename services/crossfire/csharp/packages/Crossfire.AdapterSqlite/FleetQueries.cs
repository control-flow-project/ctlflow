using Crossfire.Domain;
using Crossfire.Kernel;
using Microsoft.EntityFrameworkCore;

namespace Crossfire.AdapterSqlite;

public static class FleetQueries
{
    public static Result<FleetRecord?> Find(CrossfireDbContext context, string fleetId)
        => Stored.Read(() => context.Fleet.AsNoTracking().Where(row => row.Id == fleetId)
            .Select(row => new FleetRecord(row.Id, row.OwnerId, row.FleetKey, row.Label, row.ControllerName,
                row.Revision, row.CreatedAt, row.UpdatedAt, row.DeliveryEnabled == 1, row.ArchivedAt)).SingleOrDefault());

    public static Result<FleetCredential?> Credential(CrossfireDbContext context, string credentialId)
        => Stored.Read(() => context.FleetCredential.AsNoTracking().Where(row => row.Id == credentialId)
            .Select(row => new FleetCredential(row.Id, row.FleetId, row.SecretHash, row.CreatedAt, row.RevokedAt)).SingleOrDefault());

    public static Result<FleetConnection?> Connection(CrossfireDbContext context, string fleetId)
        => Stored.Read(() => context.FleetConnection.AsNoTracking().Where(row => row.FleetId == fleetId)
            .Select(row => new FleetConnection(row.FleetId, row.ConnectionId, row.CredentialId, row.LastSeenAt, row.ExpiresAt, row.ClosedAt)).SingleOrDefault());

    public static Result<IReadOnlyList<FleetBinding>> Bindings(CrossfireDbContext context, FleetRecord fleet)
    {
        var ownerId = fleet.OwnerId; var fleetKey = fleet.FleetKey;
        return Stored.Read<IReadOnlyList<FleetBinding>>(() => context.FleetInstance.AsNoTracking()
            .Where(row => row.OwnerId == ownerId && row.FleetKey == fleetKey && row.RetiredAt == null)
            .OrderBy(row => row.InstanceKey).Select(row => new FleetBinding(row.OwnerId, row.FleetKey, row.InstanceKey, row.AgentId, row.RetiredAt)).ToArray());
    }

    public static Result<FleetOperation?> Operation(CrossfireDbContext context, string operationId)
        => Stored.Read(() => context.FleetRuntimeOperation.AsNoTracking().Where(row => row.Id == operationId)
            .Select(row => new FleetOperation(row.Id, row.FleetId, row.AgentId, row.Action, row.ExpectedRevision, row.AuthorPrincipalId,
                row.Status, row.CreatedAt, row.CompletedAt, row.ErrorMessage, row.ConnectionId, row.CredentialId)).SingleOrDefault());

    public static Result<FleetOperation?> PendingOperation(CrossfireDbContext context, string fleetId)
        => Stored.Read(() => context.FleetRuntimeOperation.AsNoTracking().Where(row => row.FleetId == fleetId && (row.Status == "pending" || row.Status == "running"))
            .OrderBy(row => row.CreatedAt).ThenBy(row => row.Id)
            .Select(row => new FleetOperation(row.Id, row.FleetId, row.AgentId, row.Action, row.ExpectedRevision, row.AuthorPrincipalId,
                row.Status, row.CreatedAt, row.CompletedAt, row.ErrorMessage, row.ConnectionId, row.CredentialId)).FirstOrDefault());

    public static Result<Page<FleetOperation>> Operations(CrossfireDbContext context, string fleetId, int page, int pageSize)
    {
        var offset = checked((page - 1) * pageSize);
        var count = Stored.Read(() => context.FleetRuntimeOperation.LongCount(row => row.FleetId == fleetId));
        if (!count.IsSuccess) return Result<Page<FleetOperation>>.Fail(count.Error);
        var records = Stored.Read(() => context.FleetRuntimeOperation.AsNoTracking().Where(row => row.FleetId == fleetId)
            .OrderByDescending(row => row.CreatedAt).ThenByDescending(row => row.Id).Skip(offset).Take(pageSize)
            .Select(row => new FleetOperation(row.Id, row.FleetId, row.AgentId, row.Action, row.ExpectedRevision, row.AuthorPrincipalId,
                row.Status, row.CreatedAt, row.CompletedAt, row.ErrorMessage, row.ConnectionId, row.CredentialId)).ToArray());
        return records.Map(values => new Page<FleetOperation>(values, page, pageSize, count.Value));
    }
}
