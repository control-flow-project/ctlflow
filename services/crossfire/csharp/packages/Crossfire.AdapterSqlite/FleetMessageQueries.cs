using Crossfire.Domain;
using Crossfire.Kernel;
using Microsoft.EntityFrameworkCore;

namespace Crossfire.AdapterSqlite;

public static class FleetMessageQueries
{
    public static Result<FleetMessage?> Find(CrossfireDbContext context, string messageId)
        => Stored.Read(() => context.FleetMessage.AsNoTracking().Where(row => row.Id == messageId)
            .Select(row => new FleetMessage(row.Id, row.FleetId, row.AuthorPrincipalId, row.AuthorCredentialId, row.Body, row.CreatedAt, row.ExpiresAt)).SingleOrDefault());

    public static Result<Page<FleetMessage>> Page(CrossfireDbContext context, string fleetId, int page, int pageSize)
    {
        var offset = checked((page - 1) * pageSize);
        var count = Stored.Read(() => context.FleetMessage.LongCount(row => row.FleetId == fleetId));
        if (!count.IsSuccess) return Result<Page<FleetMessage>>.Fail(count.Error);
        var records = Stored.Read(() => context.FleetMessage.AsNoTracking().Where(row => row.FleetId == fleetId)
            .OrderByDescending(row => row.CreatedAt).ThenByDescending(row => row.Id).Skip(offset).Take(pageSize)
            .Select(row => new FleetMessage(row.Id, row.FleetId, row.AuthorPrincipalId, row.AuthorCredentialId, row.Body, row.CreatedAt, row.ExpiresAt)).ToArray());
        return records.Map(values => new Page<FleetMessage>(values, page, pageSize, count.Value));
    }

    public static Result<FleetMessageDelivery?> Delivery(CrossfireDbContext context, string messageId, string agentId)
        => Stored.Read(() => context.FleetMessageDelivery.AsNoTracking().Where(row => row.MessageId == messageId && row.AgentId == agentId)
            .Select(row => new FleetMessageDelivery(row.MessageId, row.AgentId, row.Status, row.CompletedAt, row.ErrorMessage)).SingleOrDefault());

    public static Result<IReadOnlyList<FleetMessageDelivery>> Deliveries(CrossfireDbContext context, IReadOnlyList<string> messageIds)
    {
        var identifiers = messageIds.ToArray();
        return Stored.Read<IReadOnlyList<FleetMessageDelivery>>(() => context.FleetMessageDelivery.AsNoTracking().Where(row => identifiers.Contains(row.MessageId))
            .OrderBy(row => row.MessageId).ThenBy(row => row.AgentId)
            .Select(row => new FleetMessageDelivery(row.MessageId, row.AgentId, row.Status, row.CompletedAt, row.ErrorMessage)).ToArray());
    }

    public static Result<string?> Pending(CrossfireDbContext context, string fleetId, long now)
        => Stored.Read(() => context.FleetMessage.AsNoTracking().Where(message => message.FleetId == fleetId && message.ExpiresAt > now
            && context.FleetMessageDelivery.Any(delivery => delivery.MessageId == message.Id && delivery.Status == "pending"))
            .OrderBy(message => message.CreatedAt).ThenBy(message => message.Id).Select(message => message.Id).FirstOrDefault());

    public static Result<long> PendingCount(CrossfireDbContext context, string fleetId, long now)
        => Stored.Read(() => context.FleetMessage.AsNoTracking().LongCount(message => message.FleetId == fleetId && message.ExpiresAt > now
            && context.FleetMessageDelivery.Any(delivery => delivery.MessageId == message.Id && delivery.Status == "pending")));

    public static Result<IReadOnlyList<FleetRecipient>> Recipients(CrossfireDbContext context, IReadOnlyList<string> agentIds)
    {
        var identifiers = agentIds.ToArray();
        return Stored.Read<IReadOnlyList<FleetRecipient>>(() => context.Agent.AsNoTracking().Where(agent => identifiers.Contains(agent.PrincipalId))
            .Join(context.Principal, agent => agent.PrincipalId, principal => principal.Id, (agent, principal) => new { agent, principal })
            .Join(context.Principal, joined => joined.agent.OwnerId, owner => owner.Id, (joined, owner) => new { joined.agent, joined.principal, owner })
            .OrderBy(joined => joined.principal.CreatedAt).ThenBy(joined => joined.principal.Id)
            .Select(joined => new FleetRecipient(joined.principal.Id, joined.principal.Status, joined.owner.Status)).ToArray());
    }
}
