using Crossfire.AdapterSqlite;
using Crossfire.AdapterSqlite.Entities;
using Crossfire.Kernel;
using Microsoft.EntityFrameworkCore;
using System.Text.Json;
using System.Text.Json.Serialization;
using Crossfire.Storage.Tests;
using static Crossfire.Storage.Tests.Checks;
using System.Runtime.CompilerServices;

if (SchemaAcceptance.Run(args)) return;
if (CalendarAcceptance.Run(args)) return;
if (await StateLockAcceptance.Run(args)) return;
if (await MatrixAcceptance.Run(args)) return;

var directory = Path.Combine(Path.GetTempPath(), "crossfire-storage-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(directory);
try
{
    var database = ArgumentsDatabase(args);
    using var context = new CrossfireDbContext(database);
    Equal(Schema.Validate(context).IsSuccess, true, "Knex-created canonical schema validation");
    Equal(Stored.Read<Unit>(() => throw new Microsoft.Data.Sqlite.SqliteException("busy", 5)).Error.Code, "unavailable", "expected storage contention remains a typed failure");
    Equal(Stored.Read<Unit>(() => throw new Microsoft.Data.Sqlite.SqliteException("full", 13)).Error.Message,
        "Management storage is full; check available disk space before retrying", "storage capacity failure retains actionable cause");
    Equal(context.Role.AsNoTracking().Count(), 3, "canonical reference role count");
    Equal(context.Permission.AsNoTracking().Count(), 36, "canonical permission count");
    var ownerId = Identity.Identifier();
    var matrixId = "@native-storage-test-" + ownerId + ":example.test";
    var created = Transactions.Run(context, () =>
    {
        context.Principal.Add(new PrincipalRow { Id = ownerId, MatrixUserId = matrixId, Kind = "human", Status = "active", Revision = 0, CreatedAt = 1700000000000 });
        context.Member.Add(new MemberRow { PrincipalId = ownerId, PrincipalKind = "human", DisplayName = "Native storage verification" });
        context.PrincipalRole.Add(new PrincipalRoleRow { PrincipalId = ownerId, PrincipalKind = "human", RoleCode = "member", AssignedAt = 1700000000000 });
        context.PrincipalApplication.Add(new PrincipalApplicationRow { PrincipalId = ownerId, NextCheckAt = 1700000000000 });
        return Result<string>.Success(ownerId);
    });
    Equal(created.IsSuccess, true, "foreign-key ordered EF insert");
    var principal = context.Principal.AsNoTracking().Single(value => value.Id == ownerId);
    Equal(principal.MatrixUserId, matrixId, "exact text persistence");
    Equal(principal.CreatedAt, 1700000000000L, "integer timestamp persistence");
    Equal(AuthorizationQueries.Principal(context, ownerId).Value?.MatrixUserId, matrixId, "precompiled context-parameter projection");
    Equal(AuthorizationQueries.Principal(context, Identity.Identifier()).Value is null, true, "query parameters are not reused");
    Equal(AuthorizationQueries.Permissions(context, ownerId).Value.Contains("member.invite"), true, "precompiled role-permission join");
    var rolledBack = Transactions.Run(context, () =>
    {
        var record = context.Member.Single(value => value.PrincipalId == ownerId);
        record.DisplayName = "Must be rolled back";
        context.SaveChanges();
        return Result<Unit>.Fail("conflict", "expected rollback");
    });
    Equal(rolledBack.IsSuccess, false, "expected failure outcome");
    Equal(context.Member.AsNoTracking().Single(value => value.PrincipalId == ownerId).DisplayName,
        "Native storage verification", "expected failures roll back flushed data");
    var collision = Transactions.Run(context, () =>
    {
        context.Principal.Add(new PrincipalRow { Id = Identity.Identifier(), MatrixUserId = matrixId, Kind = "human", Status = "active", Revision = 0, CreatedAt = 1700000000000 });
        return Results.Done();
    });
    Equal(collision.IsSuccess, false, "native uniqueness constraint");
    Equal(collision.Error.Code, "conflict", "expected duplicate failure code");
    var nested = Transactions.Run(context, () =>
    {
        context.Member.Single(value => value.PrincipalId == ownerId).DisplayName = "Outer transaction remains";
        context.SaveChanges();
        var inner = Transactions.Run(context, () =>
        {
            context.Member.Single(value => value.PrincipalId == ownerId).DisplayName = "Inner must roll back";
            context.SaveChanges();
            return Results.Fail<Unit>("conflict", "nested expected failure");
        });
        Equal(inner.Error.Code, "conflict", "nested transaction returns expected failure");
        Equal(context.Member.AsNoTracking().Single(value => value.PrincipalId == ownerId).DisplayName, "Outer transaction remains", "nested rollback preserves outer changes");
        return Results.Done();
    });
    Equal(nested.IsSuccess, true, "outer transaction commits after handled nested failure");
    await DomainAcceptance.Verify(context, ownerId, matrixId);
    await HttpAcceptance.Verify();
    await FleetChangesAcceptance.Verify();
    FilesystemAcceptance.Verify(directory);
    RoomAcceptance.Verify();
    WireAcceptance.Verify();
    Console.WriteLine(JsonSerializer.Serialize(new StorageResult("passed", database, ownerId, matrixId,
        RuntimeFeature.IsDynamicCodeSupported, JsonSerializer.IsReflectionEnabledByDefault, Checks.Passed), StorageJson.Default.StorageResult));
}
finally
{
    Directory.Delete(directory, recursive: true);
}

static string ArgumentsDatabase(string[] arguments)
    => arguments.Length switch { 1 when Path.IsPathFullyQualified(arguments[0]) => arguments[0], _ => throw new ArgumentException("Select an existing absolute Knex-migrated verification database") };

sealed record StorageResult(string Status, string Database, string OwnerId, string MatrixId, bool DynamicCode, bool ReflectionJson, int Assertions);

[JsonSerializable(typeof(StorageResult))]
partial class StorageJson : JsonSerializerContext;
