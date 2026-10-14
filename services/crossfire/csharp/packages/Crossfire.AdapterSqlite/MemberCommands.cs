using Crossfire.Domain;
using Crossfire.Kernel;
using Crossfire.AdapterSqlite.Entities;
using Microsoft.EntityFrameworkCore;

namespace Crossfire.AdapterSqlite;

public static class MemberCommands
{
    public static Result<Unit> Register(CrossfireDbContext context, Principal principal, PrincipalRole role, PrincipalApplication application, Member member)
    {
        context.Principal.Add(new() { Id = principal.Id, MatrixUserId = principal.MatrixUserId, Kind = principal.Kind, Status = principal.Status, Revision = principal.Revision, CreatedAt = principal.CreatedAt });
        context.Member.Add(new() { PrincipalId = member.PrincipalId, PrincipalKind = member.PrincipalKind, DisplayName = member.DisplayName });
        context.PrincipalRole.Add(new() { PrincipalId = role.PrincipalId, PrincipalKind = role.PrincipalKind, RoleCode = role.RoleCode, AssignedByMemberId = role.AssignedByMemberId, AssignedAt = role.AssignedAt });
        context.PrincipalApplication.Add(new() { PrincipalId = application.PrincipalId, AppliedRevision = application.AppliedRevision, AppliedIntentHash = application.AppliedIntentHash,
            AppliedStatus = application.AppliedStatus, NativeDisplayName = application.NativeDisplayName, LastAttemptAt = application.LastAttemptAt,
            LastSuccessAt = application.LastSuccessAt, NextCheckAt = application.NextCheckAt, ErrorCode = application.ErrorCode, ErrorMessage = application.ErrorMessage });
        context.SaveChanges();
        return Results.Done();
    }

    public static Result<Unit> Apply(CrossfireDbContext context, MemberChanges change)
    {
        var id = change.Before.Principal.Id;
        var principal = context.Principal.Single(row => row.Id == id);
        principal.Status = change.After.Principal.Status;
        principal.Revision = change.After.Principal.Revision;
        context.Member.Single(row => row.PrincipalId == id).DisplayName = change.After.Member.DisplayName;
        context.PrincipalApplication.Single(row => row.PrincipalId == id).NextCheckAt = change.Now;
        if (!change.NativeSelfName)
        {
            var role = context.PrincipalRole.Single(row => row.PrincipalId == id);
            role.RoleCode = change.After.Role.RoleCode;
            role.AssignedByMemberId = change.After.Role.AssignedByMemberId;
            role.AssignedAt = change.After.Role.AssignedAt;
        }
        var agents = context.Agent.Where(row => row.OwnerId == id).OrderBy(row => row.PrincipalId).ToArray();
        foreach (var agent in agents)
        {
            var agentId = agent.PrincipalId;
            var current = AuthorizationQueries.AgentView(context, agentId);
            if (!current.IsSuccess) return Result<Unit>.Fail(current.Error);
            if (current.Value is null) return Results.Fail<Unit>("missing", "Owned agent state is missing");
            if (change.After.Principal.Status == "revoked")
            {
                var agentPrincipal = context.Principal.Single(row => row.Id == agentId);
                if (agentPrincipal.Status != "revoked") { agentPrincipal.Status = "revoked"; agentPrincipal.Revision = checked(agentPrincipal.Revision + 1); }
            }
            context.PrincipalApplication.Single(row => row.PrincipalId == agentId).NextCheckAt = change.Now;
            foreach (var grant in context.RoomGrantApplication.Where(row => row.AgentId == agentId).ToArray()) grant.NextCheckAt = change.Now;
        }
        context.SaveChanges();
        return Results.Done();
    }

    public static Result<Unit> Audit(CrossfireDbContext context, AuditIntent intent, Func<long> now)
    {
        context.AuditEvent.Add(new AuditEventRow { Id = Identity.Identifier(), RequestId = intent.RequestId, ActorKind = intent.ActorKind,
            ActorPrincipalId = intent.ActorPrincipalId, OwnerId = intent.OwnerId, TargetKind = intent.TargetKind, TargetId = intent.TargetId,
            Action = intent.Action, Outcome = intent.Outcome, Message = intent.Message, CreatedAt = now() });
        context.SaveChanges();
        return Results.Done();
    }

    public static MemberPorts Ports(CrossfireDbContext context, Func<long> now)
        => new(AuthorizationQueries.Ports(context, now), new SqliteUnitOfWork(context), id => MemberQueries.Find(context, id),
            (page, size) => MemberQueries.List(context, page, size), () => MemberQueries.Administrators(context),
            value => Apply(context, value), intent => Audit(context, intent, now));
}
