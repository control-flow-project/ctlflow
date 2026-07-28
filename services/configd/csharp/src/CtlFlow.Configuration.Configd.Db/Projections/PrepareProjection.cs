using CtlFlow.Configuration.Configd.Db.Custody;
using CtlFlow.Configuration.Configd.Db.Providers;
using CtlFlow.Configuration.Configd.Domain.Auditing;
using CtlFlow.Configuration.Configd.Domain.Bindings;
using CtlFlow.Configuration.Configd.Domain.Projections;
using static CtlFlow.Configuration.Configd.Domain.Projections.ProjectionIdentities;

namespace CtlFlow.Configuration.Configd.Db.Projections;

public static partial class Projections
{
    public static async Task<ProjectionPreparationResult> PrepareProjection(
        ConfigurationDatabase configurationDatabase,
        ProjectionTarget target,
        ConsumerBinding binding,
        EncryptionKeyRing keyRing,
        AuditContext audit,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        using var activity = ConfigurationDbTelemetry.StartOperation(
            "prepare_projection");
        var mutation =
            await configurationDatabase.AcquireMutation(cancellation);
        ConfigurationDbContext? database = null;
        ProjectionPayloadLease? payload = null;
        try
        {
            var projectionId = await DeriveProjectionId(
                target.Kind,
                binding,
                cancellation);
            var existing = await QueryProjection(
                configurationDatabase,
                target.Kind,
                binding,
                cancellation);
            var idExists = await ProjectionIdExists(
                configurationDatabase,
                projectionId,
                cancellation);
            var targetWasSelected = await ProjectionTargetWasSelected(
                configurationDatabase,
                projectionId,
                target,
                cancellation);
            var targetLookup = await LoadProjectionTarget(
                configurationDatabase,
                target,
                binding,
                keyRing,
                cancellation);
            payload = targetLookup.Payload;

            database =
                await configurationDatabase.Contexts.CreateDbContextAsync(
                    cancellation);
            if (existing is not null)
            {
                database.Attach(existing);
            }

            var plan = await Domain.Projections.Projections.PlanProjection(
                target,
                binding,
                projectionId,
                existing,
                idExists && existing?.Id != projectionId,
                targetLookup.Exists,
                targetLookup.SecretIsCurrent,
                targetWasSelected,
                audit,
                cancellation);
            switch (plan)
            {
                case ProjectionPlan.NotFound:
                    return new ProjectionPreparationResult.NotFound();
                case ProjectionPlan.AlreadyExists:
                    return new ProjectionPreparationResult.AlreadyExists();
                case ProjectionPlan.FailedPrecondition:
                    return new ProjectionPreparationResult
                        .FailedPrecondition();
            }

            if (payload is null)
            {
                throw new InvalidOperationException(
                    "A ready projection has no payload");
            }

            if (plan is ProjectionPlan.Changed changed)
            {
                if (existing is null)
                {
                    database.Projections.Add(changed.Entity);
                }

                database.ProjectionTargets.Add(changed.TargetEntry);
            }

            var application = new ProjectionApplicationLease(
                database,
                mutation,
                plan,
                payload);
            database = null;
            payload = null;
            mutation = null!;
            return new ProjectionPreparationResult.Ready(application);
        }
        finally
        {
            payload?.Dispose();
            if (database is not null)
            {
                await database.DisposeAsync();
            }

            if (mutation is not null)
            {
                await mutation.DisposeAsync();
            }
        }
    }
}
