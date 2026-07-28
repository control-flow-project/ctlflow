using CtlFlow.Policy.Policyd.Db.Providers;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Policy.Policyd.Db.Schema;

public static partial class Schemas
{
    public static async Task<SchemaCompatibility> VerifySchema(
        PolicyDatabase policyDatabase,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        using var activity = PolicyDbTelemetry.StartOperation("verify_schema");
        if (await VerifyMigrationLedger(policyDatabase, cancellation)
            != SchemaCompatibility.Compatible)
        {
            return SchemaCompatibility.Different;
        }

        await using var database =
            await policyDatabase.Contexts.CreateDbContextAsync(cancellation);
        var queryCancellation = cancellation;
        await database.Roles.AsNoTracking()
            .OrderBy(value => EF.Property<string>(value, "_id"))
            .Select(value => new
            {
                Id = EF.Property<string>(value, "_id"),
                TargetKind = EF.Property<int>(value, "_targetKind"),
                TenantId = EF.Property<string>(value, "_tenantId"),
                WorkspaceId = EF.Property<string?>(value, "_workspaceId")
            })
            .Take(1)
            .ToListAsync(queryCancellation);
        await database.RoleRules.AsNoTracking()
            .OrderBy(value => EF.Property<string>(value, "_roleId"))
            .ThenBy(value => EF.Property<string>(value, "_operation"))
            .ThenBy(value => EF.Property<string>(value, "_basePath"))
            .ThenBy(value => EF.Property<int>(value, "_matchKind"))
            .Select(value => new
            {
                RoleId = EF.Property<string>(value, "_roleId"),
                Operation = EF.Property<string>(value, "_operation"),
                BasePath = EF.Property<string>(value, "_basePath"),
                MatchKind = EF.Property<int>(value, "_matchKind")
            })
            .Take(1)
            .ToListAsync(queryCancellation);
        await database.RoleBindings.AsNoTracking()
            .OrderBy(value => EF.Property<string>(value, "_roleId"))
            .ThenBy(value => EF.Property<int>(value, "_subjectKind"))
            .ThenBy(value => EF.Property<string>(value, "_subjectId"))
            .Select(value => new
            {
                RoleId = EF.Property<string>(value, "_roleId"),
                SubjectKind = EF.Property<int>(value, "_subjectKind"),
                SubjectId = EF.Property<string>(value, "_subjectId")
            })
            .Take(1)
            .ToListAsync(queryCancellation);
        await database.AccessGrants.AsNoTracking()
            .OrderBy(value => EF.Property<long>(value, "_id"))
            .Select(value => new
            {
                Id = EF.Property<long>(value, "_id"),
                TargetKind = EF.Property<int>(value, "_targetKind"),
                TenantId = EF.Property<string>(value, "_tenantId"),
                WorkspaceId = EF.Property<string?>(value, "_workspaceId"),
                SubjectKind = EF.Property<int>(value, "_subjectKind"),
                SubjectId = EF.Property<string>(value, "_subjectId"),
                Operation = EF.Property<string>(value, "_operation"),
                BasePath = EF.Property<string>(value, "_basePath"),
                MatchKind = EF.Property<int>(value, "_matchKind")
            })
            .Take(1)
            .ToListAsync(queryCancellation);

        return await ValidateStoredPolicy(policyDatabase, cancellation)
            ? SchemaCompatibility.Compatible
            : SchemaCompatibility.Different;
    }
}
