using Crossfire.Domain;
using Crossfire.Kernel;
using Microsoft.EntityFrameworkCore;

namespace Crossfire.AdapterSqlite;

public static class PolicyCommands
{
    public static Result<Unit> Update(CrossfireDbContext context, InstancePolicy policy)
    {
        var row = context.InstancePolicy.Single(value => value.Id == "instance");
        row.Revision = policy.Revision; row.MaxOwnerAgents = policy.MaxOwnerAgents; row.MaxAgents = policy.MaxAgents;
        row.MaxPending = policy.MaxPending; row.EnrollmentSeconds = policy.EnrollmentSeconds; row.ReconcileSeconds = policy.ReconcileSeconds;
        row.MaxMessageBytes = policy.MaxMessageBytes; row.FleetIdleTimeoutSeconds = policy.FleetIdleTimeoutSeconds;
        row.AgentInstructions = policy.AgentInstructions; row.SignupMode = policy.SignupMode; row.InvitationIssuers = policy.InvitationIssuers;
        context.SaveChanges(); return Results.Done();
    }

    public static PolicyPorts Ports(CrossfireDbContext context, Func<long> now)
        => new(AuthorizationQueries.Ports(context, now), new SqliteUnitOfWork(context), () => PolicyQueries.Find(context),
            value => Update(context, value), intent => MemberCommands.Audit(context, intent, now));
}
