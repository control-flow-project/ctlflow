using System.Data;
using CtlFlow.Tenancy.Tenantd.Db.Provisioning;
using CtlFlow.Tenancy.Tenantd.Domain.Auditing;
using CtlFlow.Tenancy.Tenantd.Domain.Collections;
using CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;
using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.Tenantd.Domain.Time;
using Microsoft.EntityFrameworkCore;
using static CtlFlow.Tenancy.Tenantd.Db.AuditOutbox.AuditOutboxEntries;
using static CtlFlow.Tenancy.Tenantd.Db.Lifecycles.LifecycleWork;
using static CtlFlow.Tenancy.Tenantd.Db.Requests.IdempotencyRecords;
using static CtlFlow.Tenancy.Tenantd.Db.Resources.ResourceEvents;
using static CtlFlow.Tenancy.Tenantd.Db.Sequences.Sequences;
using static CtlFlow.Tenancy.Tenantd.Db.Tenants.TenantResources;
using static CtlFlow.Tenancy.Tenantd.Domain.Addresses.TenantAddresses;
using static CtlFlow.Tenancy.Tenantd.Domain.Lifecycles.LifecycleOperations;
using static CtlFlow.Tenancy.Tenantd.Domain.Tenants.Tenants;

namespace CtlFlow.Tenancy.Tenantd.Db.Tenants;

public static partial class Tenants
{
    private const string CreateTenantOperation = "create_tenant";

    public static async Task<ResourceMutationResult<TenantResource>>
        CreateTenantResource(
            IDbContextFactory<TenantDbContext> databaseContexts,
            CreateTenantCommand command,
            AuditCorrelation auditCorrelation,
            UtcInstant now,
            CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        using var dbActivity = TenantDbTelemetry.StartOperation(
            "create_tenant_resource");
        await using var database = await databaseContexts.CreateDbContextAsync(
            cancellation);
        var queryCancellation = cancellation;
        await using var transaction = await database.Database
            .BeginTransactionAsync(IsolationLevel.Serializable, cancellation);

        var eventSequenceRow = await database.ResourceEventSequences
            .AsNoTracking()
            .Where(value => value.SequenceId == 1)
            .Select(value => new
            {
                value.SequenceId,
                value.CurrentSequence,
                value.RetainedFromSequence
            })
            .SingleAsync(queryCancellation);
        var eventSequenceState = new Sequences.ResourceEventSequenceState(
            eventSequenceRow.SequenceId,
            eventSequenceRow.CurrentSequence,
            eventSequenceRow.RetainedFromSequence);
        database.Attach(eventSequenceState);
        var eventSequence = AllocateResourceEventSequence(eventSequenceState);
        await database.SaveChangesAsync(cancellation);

        var requestActor = command.Actor.Value;
        var idempotencyKey = command.IdempotencyKey.Value;
        var queryOperationName = CreateTenantOperation;
        var repeated = await database.IdempotencyRecords
            .AsNoTracking()
            .Where(value =>
                value.RequestActor == requestActor
                && value.OperationName == queryOperationName
                && value.IdempotencyKey == idempotencyKey)
            .Select(value => new
            {
                value.RecordId,
                value.RequestActor,
                value.OperationName,
                value.IdempotencyKey,
                value.RequestHash,
                value.ResourceKind,
                value.ResourceId,
                value.LifecycleOperationId,
                value.ResultResourceRevision,
                value.ResultLifecycleState,
                value.ResultProvisioningGeneration,
                value.ResultStepRevision,
                value.ResultStepState,
                value.ResultEventSequence,
                value.CreatedAtUnixMilliseconds
            })
            .SingleOrDefaultAsync(queryCancellation);
        if (repeated is not null)
        {
            await transaction.RollbackAsync(cancellation);
            return await ResolveRepeatedCreate(
                databaseContexts,
                new Requests.IdempotencyRecord(
                    repeated.RecordId,
                    repeated.RequestActor,
                    repeated.OperationName,
                    repeated.IdempotencyKey,
                    repeated.RequestHash,
                    repeated.ResourceKind,
                    repeated.ResourceId,
                    repeated.LifecycleOperationId,
                    repeated.ResultResourceRevision,
                    repeated.ResultLifecycleState,
                    repeated.ResultProvisioningGeneration,
                    repeated.ResultStepRevision,
                    repeated.ResultStepState,
                    repeated.ResultEventSequence,
                    repeated.CreatedAtUnixMilliseconds),
                command,
                cancellation);
        }

        var authority = command.Authority.Value;
        var pathPrefix = command.PathPrefix.Value;
        var addressIsUnavailable = pathPrefix == "/"
            ? await database.TenantAddressBindings
                .AsNoTracking()
                .Where(value =>
                    EF.Property<string>(value, "_authority") == authority)
                .AnyAsync(queryCancellation)
            : await database.TenantAddressBindings
                .AsNoTracking()
                .Where(value =>
                    EF.Property<string>(value, "_authority") == authority
                    && (
                        EF.Property<string>(value, "_pathPrefix") == pathPrefix
                        || EF.Property<string>(value, "_pathPrefix") == "/"))
                .AnyAsync(queryCancellation);
        if (addressIsUnavailable)
        {
            await transaction.RollbackAsync(cancellation);
            return new ResourceMutationResult<TenantResource>.AlreadyExists(
                ResourceMutationFailure.AddressAlreadyBound);
        }

        var tenantId = TenantId.Generate();
        var operationId = LifecycleOperationId.Generate();
        var tenant = await CreateTenant(
            tenantId,
            command.DisplayName,
            operationId,
            eventSequence,
            now,
            cancellation);
        var address = await CreateTenantAddressBinding(
            Domain.Addresses.TenantAddressBindingId.Generate(),
            tenantId,
            command.Authority,
            command.PathPrefix,
            now,
            cancellation);
        var operation = await CreateLifecycleOperation(
            operationId,
            new LifecycleTarget.Tenant(tenantId),
            LifecycleOperationKind.Provision,
            tenant.ProvisioningGeneration.Value,
            command.Actor,
            command.IdempotencyKey,
            command.RequestDigest,
            now,
            cancellation);
        var deliverySequenceRow = await database.LifecycleDeliverySequences
            .AsNoTracking()
            .Where(value => value.SequenceId == 1)
            .Select(value => new
            {
                value.SequenceId,
                value.CurrentSequence
            })
            .SingleAsync(queryCancellation);
        var deliverySequenceState =
            new Sequences.LifecycleDeliverySequenceState(
                deliverySequenceRow.SequenceId,
                deliverySequenceRow.CurrentSequence);
        database.Attach(deliverySequenceState);
        var deliverySequences = AllocateLifecycleDeliverySequences(
            deliverySequenceState,
            4);

        database.Tenants.Add(tenant);
        database.TenantAddressBindings.Add(address);
        database.LifecycleOperations.Add(operation);
        AddProvisioningIntent(database, tenantId, command);
        var steps = await AddLifecycleSteps(
            database,
            operationId,
            deliverySequences,
            now,
            cancellation);
        AddTenantResourceEvent(
            database,
            tenant,
            ResourceEventKind.Added,
            steps,
            now);
        AddIdempotencyRecord(
            database,
            command.Actor,
            CreateTenantOperation,
            command.IdempotencyKey,
            command.RequestDigest,
            1,
            tenantId.Value,
            operationId.Value,
            tenant.Revision.Value,
            tenant.Lifecycle,
            tenant.ProvisioningGeneration.Value,
            null,
            null,
            eventSequence.Value,
            now);
        AddAuditOutboxEntry(
            database,
            command.Actor,
            null,
            CreateTenantOperation,
            eventSequence,
            1,
            tenantId.Value,
            null,
            tenantId.Value,
            tenant.Revision.Value,
            command.IdempotencyKey,
            auditCorrelation,
            now);

        await database.SaveChangesAsync(cancellation);
        await transaction.CommitAsync(cancellation);
        var resource = await LoadTenantResource(
            databaseContexts,
            tenant.Id,
            cancellation);
        return new ResourceMutationResult<TenantResource>.Succeeded(resource);
    }

    private static async Task<
        ResourceMutationResult<TenantResource>> ResolveRepeatedCreate(
            IDbContextFactory<TenantDbContext> databaseContexts,
            Requests.IdempotencyRecord repeated,
            CreateTenantCommand command,
            CancellationToken cancellation)
    {
        if (repeated.RequestHash != command.RequestDigest.Value
            || repeated.ResourceKind != 1)
        {
            return new ResourceMutationResult<TenantResource>.AlreadyExists(
                ResourceMutationFailure.IdempotencyConflict);
        }

        return new ResourceMutationResult<TenantResource>.Succeeded(
            await LoadTenantResourceEvent(
                databaseContexts,
                Domain.Sequences.ResourceEventSequence.FromStorage(
                    repeated.ResultEventSequence),
                cancellation));
    }

    private static void AddProvisioningIntent(
        TenantDbContext database,
        TenantId tenantId,
        CreateTenantCommand command)
    {
        var administrator = command.InitialAdministrator;
        database.TenantInitialAdministrators.Add(
            new TenantInitialAdministrator(
                tenantId.Value,
                administrator.DisplayName.Value,
                administrator.LoginIdentifier.Value,
                administrator.IdentityLink?.ProviderId.Value,
                administrator.IdentityLink?.ProviderSubject.Value));

        foreach (var package in command.BaselinePackages)
        {
            database.TenantBaselinePackages.Add(new TenantBaselinePackage(
                tenantId.Value,
                package.PackageId.Value,
                package.PackageVersion.Value));
        }
    }
}
