using Crossfire.Domain;
using Crossfire.Kernel;
using Microsoft.EntityFrameworkCore;

namespace Crossfire.AdapterSqlite;

public static class WakeCommands
{
    public static Result<Unit> Replace(CrossfireDbContext context, string agentId, string mode, IReadOnlyList<WakeSelection> senders, long revision)
    {
        foreach (var row in context.AgentWakeSender.Where(row => row.AgentId == agentId).ToArray()) context.AgentWakeSender.Remove(row);
        context.SaveChanges();
        foreach (var sender in senders) context.AgentWakeSender.Add(new() { AgentId = agentId, SenderPrincipalId = sender.PrincipalId, IncludeAgents = sender.IncludeAgents ? 1 : 0 });
        context.Agent.Single(row => row.PrincipalId == agentId).WakeMode = mode;
        context.Principal.Single(row => row.Id == agentId).Revision = revision;
        context.SaveChanges(); return Results.Done();
    }

    public static Result<IReadOnlyList<WakeSender>> Senders(CrossfireDbContext context, string agentId)
        => Stored.Read<IReadOnlyList<WakeSender>>(() => context.AgentWakeSender.AsNoTracking().Where(row => row.AgentId == agentId)
            .OrderBy(row => row.SenderPrincipalId).Select(row => new WakeSender(row.SenderPrincipalId, row.IncludeAgents == 1)).ToArray());

    public static WakePorts Ports(CrossfireDbContext context, Func<long> now)
        => new(AuthorizationQueries.Ports(context, now), new SqliteUnitOfWork(context),
            (id, mode, senders, revision) => Replace(context, id, mode, senders, revision), intent => MemberCommands.Audit(context, intent, now));
}
