using Crossfire.Domain;
using Crossfire.Kernel;
using Microsoft.EntityFrameworkCore;

namespace Crossfire.AdapterSqlite;

public static class PolicyQueries
{
    public static Result<InstancePolicy?> Find(CrossfireDbContext context)
        => Stored.Read(() => context.InstancePolicy.AsNoTracking().Where(row => row.Id == "instance")
            .Select(row => new InstancePolicy(row.Id, row.Revision, row.MaxOwnerAgents, row.MaxAgents, row.MaxPending,
                row.EnrollmentSeconds, row.ReconcileSeconds, row.MaxMessageBytes, row.FleetIdleTimeoutSeconds,
                row.AgentInstructions, row.SignupMode, row.InvitationIssuers)).SingleOrDefault());

    public static Result<Unit> Add(CrossfireDbContext context, InstancePolicy policy)
    {
        context.InstancePolicy.Add(new() { Id = policy.Id, Revision = policy.Revision, MaxOwnerAgents = policy.MaxOwnerAgents,
            MaxAgents = policy.MaxAgents, MaxPending = policy.MaxPending, EnrollmentSeconds = policy.EnrollmentSeconds,
            ReconcileSeconds = policy.ReconcileSeconds, MaxMessageBytes = policy.MaxMessageBytes, FleetIdleTimeoutSeconds = policy.FleetIdleTimeoutSeconds,
            AgentInstructions = policy.AgentInstructions, SignupMode = policy.SignupMode, InvitationIssuers = policy.InvitationIssuers });
        context.SaveChanges();
        return Results.Done();
    }

    public static PrincipalPorts Ports(CrossfireDbContext context, Func<long> now)
        => new(new SqliteUnitOfWork(context), id => MemberQueries.ByMatrixId(context, id), () => Find(context), value => Add(context, value),
            (principal, role, application, member) => MemberCommands.Register(context, principal, role, application, member), now, Identity.Identifier);
}
