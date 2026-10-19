using Crossfire.Domain;
using Crossfire.Kernel;
using Microsoft.EntityFrameworkCore;

namespace Crossfire.AdapterSqlite;

public static class PrincipalApplicationCommands
{
    public static Result<PrincipalApplication?> Find(CrossfireDbContext context, string principalId)
        => Stored.Read(() => context.PrincipalApplication.AsNoTracking().Where(row => row.PrincipalId == principalId).Select(row => new PrincipalApplication(
            row.PrincipalId, row.AppliedRevision, row.AppliedIntentHash, row.AppliedStatus, row.NativeDisplayName,
            row.LastAttemptAt, row.LastSuccessAt, row.NextCheckAt, row.ErrorCode, row.ErrorMessage)).SingleOrDefault());

    public static Result<Unit> Save(CrossfireDbContext context, PrincipalApplication value)
    {
        var principalId = value.PrincipalId;
        var row = context.PrincipalApplication.Single(row => row.PrincipalId == principalId);
        row.AppliedRevision = value.AppliedRevision; row.AppliedIntentHash = value.AppliedIntentHash; row.AppliedStatus = value.AppliedStatus;
        row.NativeDisplayName = value.NativeDisplayName; row.LastAttemptAt = value.LastAttemptAt; row.LastSuccessAt = value.LastSuccessAt;
        row.NextCheckAt = value.NextCheckAt; row.ErrorCode = value.ErrorCode; row.ErrorMessage = value.ErrorMessage;
        context.SaveChanges(); return Results.Done();
    }

    public static Result<Unit> Credential(CrossfireDbContext context, AgentCredential value)
    {
        var agentId = value.AgentId;
        var row = context.AgentCredential.Single(row => row.AgentId == agentId);
        row.ProvisioningPassword = value.ProvisioningPassword; row.AccessToken = value.AccessToken; row.UpdatedAt = value.UpdatedAt;
        context.SaveChanges(); return Results.Done();
    }

    public static Result<IReadOnlyList<string>> Due(CrossfireDbContext context, long now, int limit)
        => Stored.Read<IReadOnlyList<string>>(() => context.PrincipalApplication.AsNoTracking().Where(row => row.NextCheckAt <= now)
            .OrderBy(row => row.NextCheckAt).ThenBy(row => row.PrincipalId).Take(limit).Select(row => row.PrincipalId).ToArray());

    public static PrincipalApplyPorts Ports(CrossfireDbContext context, Func<long> now, MessagingPorts messaging, RoomOperation operation)
        => new(AuthorizationQueries.Ports(context, now), new SqliteUnitOfWork(context), messaging, operation,
            () => PolicyQueries.Find(context), id => MemberQueries.Find(context, id), id => Find(context, id), value => Save(context, value),
            id => EnrollmentQueries.Credential(context, id), value => Credential(context, value), RoomGrantCommands.Ports(context, now, messaging));
}
