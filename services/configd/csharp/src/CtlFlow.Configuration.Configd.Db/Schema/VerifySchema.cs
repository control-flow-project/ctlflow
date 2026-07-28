using CtlFlow.Configuration.Configd.Db.Providers;
using CtlFlow.Configuration.Configd.Db.Content;
using CtlFlow.Configuration.Configd.Db.Custody;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Configuration.Configd.Db.Schema;

public static partial class Schemas
{
    public static async Task<SchemaCompatibility> VerifySchema(
        ConfigurationDatabase configurationDatabase,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        using var dbActivity = ConfigurationDbTelemetry.StartOperation(
            "verify_schema");
        var ledger = await VerifyMigrationLedger(
            configurationDatabase,
            cancellation);
        if (ledger != SchemaCompatibility.Compatible)
        {
            return ledger;
        }

        await using var database =
            await configurationDatabase.Contexts.CreateDbContextAsync(
            cancellation);
        var queryCancellation = cancellation;
        await database.Configurations
            .AsNoTracking()
            .OrderBy(value =>
                EF.Property<string>(value, "_configurationId"))
            .Select(value => new
            {
                ConfigurationId =
                    EF.Property<string>(value, "_configurationId"),
                CurrentConfigurationVersionId = EF.Property<string>(
                    value,
                    "_currentConfigurationVersionId"),
                Revision = EF.Property<long>(value, "_revision")
            })
            .Take(1)
            .ToListAsync(queryCancellation);
        await database.Set<ConfigurationVersionContentRow>()
            .AsNoTracking()
            .OrderBy(value => EF.Property<string>(
                value,
                "ConfigurationVersionId"))
            .Select(value => new
            {
                ConfigurationVersionId = EF.Property<string>(
                    value,
                    "ConfigurationVersionId"),
                ConfigurationId = EF.Property<string>(
                    value,
                    "ConfigurationId"),
                ContentLength = EF.Property<int>(
                    value,
                    "ContentLength")
            })
            .Take(1)
            .ToListAsync(queryCancellation);
        await database.Secrets
            .AsNoTracking()
            .OrderBy(value => EF.Property<string>(value, "_secretId"))
            .Select(value => new
            {
                SecretId = EF.Property<string>(value, "_secretId"),
                CurrentSecretVersionId = EF.Property<string>(
                    value,
                    "_currentSecretVersionId"),
                Revision = EF.Property<long>(value, "_revision")
            })
            .Take(1)
            .ToListAsync(queryCancellation);
        await database.Set<SecretVersionEnvelopeRow>()
            .AsNoTracking()
            .OrderBy(value => EF.Property<string>(
                value,
                "SecretVersionId"))
            .Select(value => new
            {
                SecretVersionId = EF.Property<string>(
                    value,
                    "SecretVersionId"),
                SecretId = EF.Property<string>(value, "SecretId"),
                EncryptionKeyId = EF.Property<string>(
                    value,
                    "EncryptionKeyId")
            })
            .Take(1)
            .ToListAsync(queryCancellation);
        await database.Projections
            .AsNoTracking()
            .OrderBy(value =>
                EF.Property<string>(value, "_projectionId"))
            .Select(value => new
            {
                ProjectionId =
                    EF.Property<string>(value, "_projectionId"),
                CurrentTargetVersionId = EF.Property<string>(
                    value,
                    "_currentTargetVersionId"),
                Revision = EF.Property<long>(value, "_revision")
            })
            .Take(1)
            .ToListAsync(queryCancellation);
        await database.ProjectionTargets
            .AsNoTracking()
            .OrderBy(value =>
                EF.Property<string>(value, "_projectionId"))
            .ThenBy(value =>
                EF.Property<string>(value, "_targetVersionId"))
            .Select(value => new
            {
                ProjectionId =
                    EF.Property<string>(value, "_projectionId"),
                TargetVersionId =
                    EF.Property<string>(value, "_targetVersionId"),
                EnteredAtRevision =
                    EF.Property<long>(value, "_enteredAtRevision")
            })
            .Take(1)
            .ToListAsync(queryCancellation);

        return SchemaCompatibility.Compatible;
    }
}
