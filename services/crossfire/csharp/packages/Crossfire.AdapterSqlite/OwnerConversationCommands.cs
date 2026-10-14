using Crossfire.Domain;
using Crossfire.Kernel;
using Microsoft.EntityFrameworkCore;

namespace Crossfire.AdapterSqlite;

public static class OwnerConversationCommands
{
    public static Result<OwnerConversation?> Find(CrossfireDbContext context, string agentId)
        => Stored.Read(() => context.AgentOwnerConversation.AsNoTracking().Where(row => row.AgentId == agentId)
            .Select(row => new OwnerConversation(row.AgentId, row.OwnerId, row.RoomId, row.CreatedAt)).SingleOrDefault());

    public static Result<Unit> Insert(CrossfireDbContext context, OwnerConversation value)
    {
        context.AgentOwnerConversation.Add(new() { AgentId = value.AgentId, OwnerId = value.OwnerId, RoomId = value.RoomId, CreatedAt = value.CreatedAt });
        context.SaveChanges(); return Results.Done();
    }

    public static OwnerConversationPorts Ports(CrossfireDbContext context, Func<long> now, MatrixPorts matrix, RoomOperation operation)
        => new(new(RoomGrantCommands.Ports(context, now, matrix.Room), matrix, () => PolicyQueries.Find(context),
                id => PrincipalApplicationCommands.Find(context, id), operation),
            id => Find(context, id), value => Insert(context, value));
}
