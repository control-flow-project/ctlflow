using Crossfire.Domain;
using Crossfire.Kernel;
using Microsoft.EntityFrameworkCore;

namespace Crossfire.AdapterSqlite;

public static class SessionCommands
{
    public static Result<Unit> RemoveExpired(CrossfireDbContext context, long now)
    {
        foreach (var row in context.MemberSession.Where(row => row.ExpiresAt <= now).ToArray()) context.MemberSession.Remove(row);
        context.SaveChanges();
        return Results.Done();
    }

    public static Result<long> Count(CrossfireDbContext context, string memberId, long now)
        => Stored.Read(() => context.MemberSession.Where(row => row.MemberId == memberId && row.ExpiresAt > now).LongCount());

    public static Result<Unit> Add(CrossfireDbContext context, MemberSession session)
    {
        context.MemberSession.Add(new() { SecretHash = session.SecretHash, MemberId = session.MemberId, CsrfSecret = session.CsrfSecret,
            NativeAccessToken = session.NativeAccessToken, CreatedAt = session.CreatedAt, ExpiresAt = session.ExpiresAt });
        context.SaveChanges();
        return Results.Done();
    }

    public static Result<Unit> Remove(CrossfireDbContext context, string hash)
        => Transactions.Run(context, () =>
        {
            var row = context.MemberSession.SingleOrDefault(row => row.SecretHash == hash);
            if (row is not null) context.MemberSession.Remove(row);
            return Results.Done();
        });

    public static SessionPorts Ports(CrossfireDbContext context, Func<long> now,
        Func<string, CancellationToken, ValueTask<Result<string>>> identify)
        => new(AuthorizationQueries.Ports(context, now), new SqliteUnitOfWork(context), identify,
            id => MemberQueries.ByMatrixId(context, id), id => MemberQueries.Find(context, id),
            timestamp => RemoveExpired(context, timestamp), (id, timestamp) => Count(context, id, timestamp),
            value => Add(context, value), hash => Remove(context, hash), Identity.Secret, Identity.Hash);
}
