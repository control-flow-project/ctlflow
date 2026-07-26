using CtlFlow.Identity.Identityd.Db;
using CtlFlow.Identity.Identityd.Db.Providers;
using CtlFlow.Identity.Identityd.Db.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;
using static CtlFlow.Identity.Identityd.Db.Providers.IdentityDatabaseProviders;

namespace CtlFlow.Identity.Identityd.IntegrationTests.Model;

internal static partial class ModelAudits
{
    private static readonly string[] ExpectedConcurrencyTokens =
    [
        "Account.Revision",
        "ExternalIdentityLink.Revision",
        "InvocationVerificationKey.Revision",
        "Session.Revision",
        "TenantMembership.Revision",
        "VirtualPrincipal.Revision",
        "WorkspaceMembership.Revision"
    ];

    private static readonly IReadOnlyDictionary<string, string[]>
        ExpectedExternalColumns =
            new Dictionary<string, string[]>(StringComparer.Ordinal)
            {
                ["knex_migrations"] = ["batch", "migration_time"]
            };

    internal static async Task AuditIdentityModel(
        string databasePath,
        CancellationToken cancellation)
    {
        var path = await DatabaseFilePath.Parse(databasePath, cancellation);
        var poolSize = await DatabasePoolSize.Parse(1, cancellation);
        var database = await CreateIdentityDatabase(
            new DatabaseConfiguration.Sqlite(path, poolSize),
            cancellation);
        await using var context = await database.Contexts.CreateDbContextAsync(
            cancellation);
        Require(
            context.Database.ProviderName
                == "Microsoft.EntityFrameworkCore.Sqlite",
            "The identityd model is not using the SQLite provider");
        Require(
            context.Model.GetType().FullName
                == "CtlFlow.Identity.Identityd.Db.Generated.IdentityDbContextModel",
            "The generated identityd compiled model was not selected");

        await context.Database.OpenConnectionAsync(cancellation);
        var sqlite = await ReadSqliteTables(
            context.Database.GetDbConnection(),
            cancellation);
        AuditEntities(context.Model);
        AuditTables(context.Model, sqlite);
        AuditConcurrencyTokens(context.Model);
    }

    private static void AuditEntities(IModel model)
    {
        foreach (var entity in model.GetEntityTypes())
        {
            Require(
                !entity.ClrType.IsSealed,
                $"Mapped entity {entity.DisplayName()} is sealed");
            var tableName = entity.GetTableName();
            Require(
                tableName is not null,
                $"Mapped entity {entity.DisplayName()} has no table");
            var store = StoreObjectIdentifier.Table(
                tableName!,
                entity.GetSchema());
            foreach (var property in entity.GetProperties())
            {
                Require(
                    !property.IsShadowProperty(),
                    $"{entity.DisplayName()}.{property.Name} is shadow state");
                Require(
                    property.GetColumnName(store) is not null,
                    $"{entity.DisplayName()}.{property.Name} is not mapped");
                if (property.ClrType == typeof(string))
                {
                    Require(
                        property.GetMaxLength() is > 0,
                        $"{entity.DisplayName()}.{property.Name} "
                        + "has no finite maximum length");
                }
            }
        }
    }

    private static void AuditTables(
        IModel model,
        IReadOnlyDictionary<string, SqliteTable> sqlite)
    {
        var relational = model.GetRelationalModel();
        var modelTables = relational.Tables
            .ToDictionary(table => table.Name, StringComparer.Ordinal);
        RequireSequence(
            modelTables.Keys,
            sqlite.Keys,
            "table inventory");

        foreach (var (name, table) in modelTables)
        {
            var actual = sqlite[name];
            var modelColumns = table.Columns.ToDictionary(
                column => column.Name,
                StringComparer.Ordinal);
            var expectedColumns = modelColumns.Keys.Concat(
                ExpectedExternalColumns.GetValueOrDefault(name) ?? []);
            RequireSequence(
                expectedColumns,
                actual.Columns.Keys,
                $"{name} column inventory");
            foreach (var (columnName, column) in modelColumns)
            {
                var stored = actual.Columns[columnName];
                Require(
                    column.IsNullable != stored.Required,
                    $"{name}.{columnName} nullability differs");
                Require(
                    GetSqliteAffinity(column.StoreType) == stored.Affinity,
                    $"{name}.{columnName} affinity differs");
            }

            var modelPrimaryKey = table.PrimaryKey?.Columns
                .Select(column => column.Name)
                .ToArray()
                ?? [];
            var storedPrimaryKey = actual.Columns.Values
                .Where(column => column.PrimaryKeyOrder > 0)
                .OrderBy(column => column.PrimaryKeyOrder)
                .Select(column => column.Name)
                .ToArray();
            RequireSequence(
                modelPrimaryKey,
                storedPrimaryKey,
                $"{name} primary key");

            RequireSequence(
                table.ForeignKeyConstraints.Select(foreignKey =>
                    new SqliteForeignKey(
                        name,
                        foreignKey.Columns
                            .Select(column => column.Name)
                            .ToArray(),
                        foreignKey.PrincipalTable.Name,
                        foreignKey.PrincipalColumns
                            .Select(column => column.Name)
                            .ToArray(),
                        foreignKey.OnDeleteAction
                            .ToString()
                            .ToUpperInvariant())
                    .Signature),
                actual.ForeignKeys.Select(value => value.Signature),
                $"{name} foreign keys");
            RequireSequence(
                table.Indexes.Select(index =>
                    new SqliteIndex(
                        index.IsUnique,
                        index.Columns
                            .Select(column => column.Name)
                            .ToArray())
                    .Signature),
                actual.Indexes.Select(value => value.Signature),
                $"{name} indexes");
        }
    }

    private static void AuditConcurrencyTokens(IModel model)
    {
        var actual = model.GetEntityTypes()
            .SelectMany(entity => entity.GetProperties()
                .Where(property => property.IsConcurrencyToken)
                .Select(property =>
                {
                    var providerType =
                        property.GetTypeMapping().Converter?.ProviderClrType
                        ?? property.ClrType;
                    Require(
                        providerType == typeof(long),
                        $"{entity.DisplayName()}.{property.Name} "
                        + "is not a long concurrency token");
                    return $"{entity.ClrType.Name}.{property.Name}";
                }));
        RequireSequence(
            ExpectedConcurrencyTokens,
            actual,
            "concurrency-token inventory");
    }

    private static void RequireSequence(
        IEnumerable<string> expected,
        IEnumerable<string> actual,
        string subject)
    {
        var orderedExpected = expected
            .OrderBy(value => value, StringComparer.Ordinal)
            .ToArray();
        var orderedActual = actual
            .OrderBy(value => value, StringComparer.Ordinal)
            .ToArray();
        Require(
            orderedExpected.SequenceEqual(
                orderedActual,
                StringComparer.Ordinal),
            $"{subject} differs; expected [{string.Join(", ", orderedExpected)}]"
            + $", actual [{string.Join(", ", orderedActual)}]");
    }

    private static void Require(bool condition, string message)
    {
        if (!condition)
        {
            throw new InvalidOperationException(message);
        }
    }
}
