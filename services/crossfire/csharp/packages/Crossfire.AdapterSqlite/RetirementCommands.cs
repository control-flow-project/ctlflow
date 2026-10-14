using Crossfire.Domain;
using Crossfire.Kernel;
using Microsoft.EntityFrameworkCore;

namespace Crossfire.AdapterSqlite;

public static class RetirementCommands
{
    public static Result<Unit> Stop(CrossfireDbContext context, NativeStop value)
    {
        context.FleetNativeStop.Add(new() { AgentId = value.AgentId, ReceiptId = value.ReceiptId, Sequence = value.Sequence, FleetId = value.FleetId,
            RunId = value.RunId, ConnectionId = value.ConnectionId, CredentialId = value.CredentialId, NativeStoppedAt = value.NativeStoppedAt, InvalidatedAt = value.InvalidatedAt });
        context.SaveChanges(); return Results.Done();
    }

    public static Result<Unit> Retire(CrossfireDbContext context, FleetBinding binding, long now)
    {
        if (binding.RetiredAt is not null) return Results.Done();
        var agentId = binding.AgentId;
        context.FleetInstance.Single(row => row.AgentId == agentId).RetiredAt = now;
        var principal = context.Principal.Single(row => row.Id == agentId);
        if (principal.Status == "active")
        {
            principal.Status = "suspended"; principal.Revision = checked(principal.Revision + 1);
            context.PrincipalApplication.Single(row => row.PrincipalId == agentId).NextCheckAt = now;
        }
        foreach (var run in context.ListenerRun.Where(row => row.AgentId == agentId && row.StoppedAt == null).ToArray())
            run.DisconnectRequestedAt ??= now;
        context.SaveChanges(); return Results.Done();
    }

    public static Result<IReadOnlyList<FleetCredential>> Credentials(CrossfireDbContext context, string fleetId)
        => Stored.Read<IReadOnlyList<FleetCredential>>(() => context.FleetCredential.AsNoTracking().Where(row => row.FleetId == fleetId).OrderBy(row => row.Id)
            .Select(row => new FleetCredential(row.Id, row.FleetId, row.SecretHash, row.CreatedAt, row.RevokedAt)).ToArray());

    public static Result<Unit> Credential(CrossfireDbContext context, FleetCredential value)
    {
        var id = value.Id;
        context.FleetCredential.Single(row => row.Id == id).RevokedAt = value.RevokedAt;
        context.SaveChanges(); return Results.Done();
    }

    public static RetirementPorts Ports(CrossfireDbContext context, Func<long> now)
        => new(FleetCommands.Ports(context, now), ListenerCommands.Ports(context, now), (agents, fleets, timestamp) => RetirementQueries.Snapshot(context, agents, fleets, timestamp),
            id => RetirementQueries.Stop(context, id), (id, receipt) => RetirementQueries.Receipt(context, id, receipt), value => Stop(context, value),
            binding => Retire(context, binding, now()), id => Credentials(context, id), value => Credential(context, value));
}
