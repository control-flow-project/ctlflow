using Crossfire.Domain;
using Crossfire.Kernel;
using Microsoft.EntityFrameworkCore;

namespace Crossfire.AdapterSqlite;

public static class AgentCommands
{
    public static Result<Unit> Update(CrossfireDbContext context, Principal principal, PrincipalApplication application)
    {
        var id = principal.Id;
        var row = context.Principal.Single(value => value.Id == id);
        row.Status = principal.Status; row.Revision = principal.Revision;
        context.PrincipalApplication.Single(value => value.PrincipalId == id).NextCheckAt = application.NextCheckAt;
        context.SaveChanges(); return Results.Done();
    }

    public static AgentPorts Ports(CrossfireDbContext context, Func<long> now)
        => new(AuthorizationQueries.Ports(context, now), new SqliteUnitOfWork(context),
            (principal, application) => Update(context, principal, application), intent => MemberCommands.Audit(context, intent, now));
}
