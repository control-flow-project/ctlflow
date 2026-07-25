using System.Data;
using CtlFlow.Tenancy.Tenantd.Db.Provisioning;
using CtlFlow.Tenancy.Tenantd.Domain.Auditing;
using CtlFlow.Tenancy.Tenantd.Domain.Collections;
using CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;
using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.Tenantd.Domain.Time;
using CtlFlow.Tenancy.Tenantd.Domain.Workspaces;
using Microsoft.EntityFrameworkCore;
using static CtlFlow.Tenancy.Tenantd.Db.AuditOutbox.AuditOutboxEntries;
using static CtlFlow.Tenancy.Tenantd.Db.Lifecycles.LifecycleWork;
using static CtlFlow.Tenancy.Tenantd.Db.Requests.IdempotencyRecords;
using static CtlFlow.Tenancy.Tenantd.Db.Resources.ResourceEvents;
using static CtlFlow.Tenancy.Tenantd.Db.Sequences.Sequences;
using static CtlFlow.Tenancy.Tenantd.Db.Workspaces.WorkspaceResources;
using static CtlFlow.Tenancy.Tenantd.Domain.Lifecycles.LifecycleOperations;
using static CtlFlow.Tenancy.Tenantd.Domain.Workspaces.WorkspaceAddresses;
using static CtlFlow.Tenancy.Tenantd.Domain.Workspaces.Workspaces;

namespace CtlFlow.Tenancy.Tenantd.Db.Workspaces;

public static partial class Workspaces
{
    private const string CreateWorkspaceOperation = "create_workspace";

    public static async Task<ResourceMutationResult<WorkspaceResource>>
        CreateWorkspaceResource(
            IDbContextFactory<TenantDbContext> databaseContexts,
            CreateWorkspaceCommand command,
            AuditCorrelation auditCorrelation,
            UtcInstant now,
            CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        using var dbActivity = TenantDbTelemetry.StartOperation(
            "create_workspace_resource");
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
        var queryOperationName = CreateWorkspaceOperation;
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

        var tenantId = command.TenantId.Value;
        var parentLifecycle = await database.Tenants
            .AsNoTracking()
            .Where(value => EF.Property<string>(value, "_id") == tenantId)
            .Select(value => (LifecycleState?)value.Lifecycle)
            .SingleOrDefaultAsync(queryCancellation);
        if (parentLifecycle is null)
        {
            await transaction.RollbackAsync(cancellation);
            return new ResourceMutationResult<WorkspaceResource>.NotFound();
        }

        if (parentLifecycle != LifecycleState.Active)
        {
            await transaction.RollbackAsync(cancellation);
            return new ResourceMutationResult<WorkspaceResource>
                .FailedPrecondition(
                    ResourceMutationFailure.ParentTenantNotActive);
        }

        var workspaceAddress = command.Address.Value;
        var addressIsUnavailable = await database.WorkspaceAddressBindings
            .AsNoTracking()
            .Where(value =>
                EF.Property<string>(value, "_tenantId") == tenantId
                && EF.Property<string>(value, "_workspaceAddress")
                    == workspaceAddress)
            .AnyAsync(queryCancellation);
        if (addressIsUnavailable)
        {
            await transaction.RollbackAsync(cancellation);
            return new ResourceMutationResult<WorkspaceResource>.AlreadyExists(
                ResourceMutationFailure.AddressAlreadyBound);
        }

        var workspaceId = WorkspaceId.Generate();
        var operationId = LifecycleOperationId.Generate();
        var workspace = await CreateWorkspace(
            workspaceId,
            command.TenantId,
            command.DisplayName,
            operationId,
            eventSequence,
            now,
            cancellation);
        var address = await CreateWorkspaceAddressBinding(
            WorkspaceAddressBindingId.Generate(),
            command.TenantId,
            workspaceId,
            command.Address,
            now,
            cancellation);
        var operation = await CreateLifecycleOperation(
            operationId,
            new LifecycleTarget.Workspace(command.TenantId, workspaceId),
            LifecycleOperationKind.Provision,
            workspace.ProvisioningGeneration.Value,
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

        database.Workspaces.Add(workspace);
        database.WorkspaceAddressBindings.Add(address);
        database.LifecycleOperations.Add(operation);
        AddProvisioningIntent(database, workspaceId, command);
        var steps = await AddLifecycleSteps(
            database,
            operationId,
            deliverySequences,
            now,
            cancellation);
        AddWorkspaceResourceEvent(
            database,
            workspace,
            ResourceEventKind.Added,
            steps,
            now);
        AddIdempotencyRecord(
            database,
            command.Actor,
            CreateWorkspaceOperation,
            command.IdempotencyKey,
            command.RequestDigest,
            2,
            workspaceId.Value,
            operationId.Value,
            workspace.Revision.Value,
            workspace.Lifecycle,
            workspace.ProvisioningGeneration.Value,
            null,
            null,
            eventSequence.Value,
            now);
        AddAuditOutboxEntry(
            database,
            command.Actor,
            null,
            CreateWorkspaceOperation,
            eventSequence,
            2,
            command.TenantId.Value,
            workspaceId.Value,
            workspaceId.Value,
            workspace.Revision.Value,
            command.IdempotencyKey,
            auditCorrelation,
            now);

        await database.SaveChangesAsync(cancellation);
        await transaction.CommitAsync(cancellation);
        var resource = await LoadWorkspaceResource(
            databaseContexts,
            workspace.Id,
            cancellation);
        return new ResourceMutationResult<WorkspaceResource>.Succeeded(
            resource);
    }

    private static async Task<
        ResourceMutationResult<WorkspaceResource>> ResolveRepeatedCreate(
            IDbContextFactory<TenantDbContext> databaseContexts,
            Requests.IdempotencyRecord repeated,
            CreateWorkspaceCommand command,
            CancellationToken cancellation)
    {
        if (repeated.RequestHash != command.RequestDigest.Value
            || repeated.ResourceKind != 2)
        {
            return new ResourceMutationResult<WorkspaceResource>
                .AlreadyExists(ResourceMutationFailure.IdempotencyConflict);
        }

        return new ResourceMutationResult<WorkspaceResource>.Succeeded(
            await LoadWorkspaceResourceEvent(
                databaseContexts,
                Domain.Sequences.ResourceEventSequence.FromStorage(
                    repeated.ResultEventSequence),
                cancellation));
    }

    private static void AddProvisioningIntent(
        TenantDbContext database,
        WorkspaceId workspaceId,
        CreateWorkspaceCommand command)
    {
        foreach (var membership in command.InitialMemberships)
        {
            database.WorkspaceInitialMemberships.Add(
                new WorkspaceInitialMembership(
                    workspaceId.Value,
                    membership.UserId.Value,
                    (int)membership.Standing));
        }

        foreach (var package in command.BaselinePackages)
        {
            database.WorkspaceBaselinePackages.Add(
                new WorkspaceBaselinePackage(
                    workspaceId.Value,
                    package.PackageId.Value,
                    package.PackageVersion.Value));
        }
    }
}
