using Crossfire.Domain;
using Crossfire.Kernel;
using Microsoft.EntityFrameworkCore;

namespace Crossfire.AdapterSqlite;

public static class FleetMessageCommands
{
    public static Result<Unit> Insert(CrossfireDbContext context, FleetMessage value)
    {
        context.FleetMessage.Add(new() { Id = value.Id, FleetId = value.FleetId, AuthorPrincipalId = value.AuthorPrincipalId,
            AuthorCredentialId = value.AuthorCredentialId, Body = value.Body, CreatedAt = value.CreatedAt, ExpiresAt = value.ExpiresAt });
        context.SaveChanges(); return Results.Done();
    }

    public static Result<Unit> InsertDelivery(CrossfireDbContext context, FleetMessageDelivery value)
    {
        context.FleetMessageDelivery.Add(new() { MessageId = value.MessageId, AgentId = value.AgentId, Status = value.Status,
            CompletedAt = value.CompletedAt, ErrorMessage = value.ErrorMessage });
        context.SaveChanges(); return Results.Done();
    }

    public static Result<Unit> SaveDelivery(CrossfireDbContext context, FleetMessageDelivery value)
    {
        var messageId = value.MessageId; var agentId = value.AgentId;
        var row = context.FleetMessageDelivery.Single(row => row.MessageId == messageId && row.AgentId == agentId);
        row.Status = value.Status; row.CompletedAt = value.CompletedAt; row.ErrorMessage = value.ErrorMessage;
        context.SaveChanges(); return Results.Done();
    }

    public static FleetMessagePorts Ports(CrossfireDbContext context, Func<long> now)
        => new(FleetCommands.Ports(context, now), id => FleetMessageQueries.Find(context, id), value => Insert(context, value),
            (id, page, size) => FleetMessageQueries.Page(context, id, page, size), ids => FleetMessageQueries.Deliveries(context, ids),
            (message, agent) => FleetMessageQueries.Delivery(context, message, agent), value => InsertDelivery(context, value), value => SaveDelivery(context, value),
            (id, time) => FleetMessageQueries.Pending(context, id, time), (id, time) => FleetMessageQueries.PendingCount(context, id, time),
            ids => FleetMessageQueries.Recipients(context, ids));
}
