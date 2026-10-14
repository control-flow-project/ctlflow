using Crossfire.Domain;
using Crossfire.Kernel;
using Microsoft.EntityFrameworkCore;

namespace Crossfire.AdapterSqlite;

public static class FleetCommands
{
    public static Result<Unit> Save(CrossfireDbContext context, FleetRecord fleet)
    {
        var fleetId = fleet.Id;
        var row = context.Fleet.Single(value => value.Id == fleetId);
        row.Label = fleet.Label; row.ControllerName = fleet.ControllerName; row.Revision = fleet.Revision;
        row.UpdatedAt = fleet.UpdatedAt; row.DeliveryEnabled = fleet.DeliveryEnabled ? 1 : 0; row.ArchivedAt = fleet.ArchivedAt;
        context.SaveChanges(); return Results.Done();
    }

    public static Result<Unit> Connection(CrossfireDbContext context, FleetConnection value)
    {
        var fleetId = value.FleetId;
        var row = context.FleetConnection.SingleOrDefault(row => row.FleetId == fleetId);
        if (row is null)
        {
            row = new() { FleetId = fleetId };
            context.FleetConnection.Add(row);
        }
        row.ConnectionId = value.ConnectionId; row.CredentialId = value.CredentialId; row.LastSeenAt = value.LastSeenAt;
        row.ExpiresAt = value.ExpiresAt; row.ClosedAt = value.ClosedAt;
        context.SaveChanges(); return Results.Done();
    }

    public static Result<Unit> InsertOperation(CrossfireDbContext context, FleetOperation value)
    {
        context.FleetRuntimeOperation.Add(new() { Id = value.OperationId, FleetId = value.FleetId, AgentId = value.AgentId, Action = value.Action,
            ExpectedRevision = value.ExpectedRevision, AuthorPrincipalId = value.AuthorPrincipalId, Status = value.Status, CreatedAt = value.CreatedAt,
            CompletedAt = value.CompletedAt, ErrorMessage = value.ErrorMessage, ConnectionId = value.ConnectionId, CredentialId = value.CredentialId });
        context.SaveChanges(); return Results.Done();
    }

    public static Result<Unit> SaveOperation(CrossfireDbContext context, FleetOperation value)
    {
        var operationId = value.OperationId;
        var row = context.FleetRuntimeOperation.Single(row => row.Id == operationId);
        row.Status = value.Status; row.CompletedAt = value.CompletedAt; row.ErrorMessage = value.ErrorMessage;
        row.ConnectionId = value.ConnectionId; row.CredentialId = value.CredentialId;
        context.SaveChanges(); return Results.Done();
    }

    public static FleetPorts Ports(CrossfireDbContext context, Func<long> now)
        => new(AuthorizationQueries.Ports(context, now), new SqliteUnitOfWork(context),
            id => FleetQueries.Find(context, id), fleet => Save(context, fleet), id => FleetQueries.Credential(context, id),
            id => FleetQueries.Connection(context, id), value => Connection(context, value), fleet => FleetQueries.Bindings(context, fleet),
            id => FleetQueries.Operation(context, id), id => FleetQueries.PendingOperation(context, id), (id, page, size) => FleetQueries.Operations(context, id, page, size),
            value => InsertOperation(context, value), value => SaveOperation(context, value), intent => MemberCommands.Audit(context, intent, now));
}
