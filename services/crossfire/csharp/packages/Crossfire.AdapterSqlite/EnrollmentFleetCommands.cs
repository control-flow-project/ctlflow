using Crossfire.Domain;
using Crossfire.Kernel;
using Microsoft.EntityFrameworkCore;

namespace Crossfire.AdapterSqlite;

public static class EnrollmentFleetCommands
{
    public static Result<Unit> Fleet(CrossfireDbContext context, FleetRecord value, bool create)
    {
        if (!create) return FleetCommands.Save(context, value);
        context.Fleet.Add(new() { Id = value.Id, OwnerId = value.OwnerId, FleetKey = value.FleetKey, Label = value.Label, ControllerName = value.ControllerName,
            Revision = value.Revision, CreatedAt = value.CreatedAt, UpdatedAt = value.UpdatedAt, DeliveryEnabled = value.DeliveryEnabled ? 1 : 0, ArchivedAt = value.ArchivedAt });
        context.SaveChanges(); return Results.Done();
    }

    public static Result<Unit> Binding(CrossfireDbContext context, FleetBinding value, bool create)
    {
        var ownerId = value.OwnerId; var fleetKey = value.FleetKey; var instanceKey = value.InstanceKey;
        var row = create ? new Entities.FleetInstanceRow { OwnerId = ownerId, FleetKey = fleetKey, InstanceKey = instanceKey, AgentId = value.AgentId }
            : context.FleetInstance.Single(row => row.OwnerId == ownerId && row.FleetKey == fleetKey && row.InstanceKey == instanceKey);
        if (create) context.FleetInstance.Add(row);
        row.RetiredAt = value.RetiredAt;
        context.SaveChanges(); return Results.Done();
    }

    public static Result<Unit> Credential(CrossfireDbContext context, FleetCredential value)
    {
        context.FleetCredential.Add(new() { Id = value.Id, FleetId = value.FleetId, SecretHash = value.SecretHash, CreatedAt = value.CreatedAt, RevokedAt = value.RevokedAt });
        context.SaveChanges(); return Results.Done();
    }

    public static Result<Unit> Metadata(CrossfireDbContext context, string fleetId, IReadOnlyDictionary<string, string> values)
    {
        foreach (var entry in values)
        {
            var key = entry.Key;
            var row = context.FleetControllerMetadata.SingleOrDefault(row => row.FleetId == fleetId && row.Key == key);
            if (row is null) context.FleetControllerMetadata.Add(new() { FleetId = fleetId, Key = entry.Key, Value = entry.Value });
            else row.Value = entry.Value;
        }
        context.SaveChanges(); return Results.Done();
    }

    public static Result<Unit> Policy(CrossfireDbContext context, string agentId, RoomPolicy value, long now)
    {
        var row = context.FleetInstancePolicy.SingleOrDefault(row => row.AgentId == agentId);
        if (row is null)
        {
            row = new() { AgentId = agentId };
            context.FleetInstancePolicy.Add(row);
        }
        row.ApprovedByMemberId = value.ApprovedByMemberId; row.ApprovedAt = now;
        context.FleetInstancePermission.RemoveRange(context.FleetInstancePermission.Where(row => row.AgentId == agentId).ToArray());
        context.SaveChanges();
        foreach (var code in value.Permissions) context.FleetInstancePermission.Add(new() { AgentId = agentId, PermissionCode = code, GrantScope = "agent_room" });
        context.SaveChanges(); return Results.Done();
    }
}
