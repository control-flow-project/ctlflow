using CtlFlow.Tenancy.Tenantd.Domain.Collections;
using CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;
using CtlFlow.Tenancy.Tenantd.Domain.Time;
using static CtlFlow.Tenancy.Tenantd.Db.Resources.ResourceEvents;
using static CtlFlow.Tenancy.Tenantd.Domain.Addresses.TenantAddresses;
using static CtlFlow.Tenancy.Tenantd.Domain.Tenants.Tenants;
using static CtlFlow.Tenancy.Tenantd.Domain.Workspaces.WorkspaceAddresses;
using static CtlFlow.Tenancy.Tenantd.Domain.Workspaces.Workspaces;

namespace CtlFlow.Tenancy.Tenantd.Db.Lifecycles;

public static partial class Lifecycles
{
    private static async Task<AcceptedTargetState> ApplyTargetProgress(
        TenantDbContext database,
        TargetState target,
        LifecycleOperation operation,
        IReadOnlyList<LifecycleStep> steps,
        Domain.Addresses.TenantAddressBinding? tenantAddress,
        Domain.Workspaces.WorkspaceAddressBinding? workspaceAddress,
        Domain.Sequences.ResourceEventSequence eventSequence,
        UtcInstant now,
        CancellationToken cancellation)
    {
        var blocked = steps.Any(value =>
            value.State == LifecycleStepState.Blocked);
        var complete = steps.All(value =>
            value.State == LifecycleStepState.Complete);

        if (target.Tenant is not null)
        {
            await ApplyTenantLifecycleProgress(
                target.Tenant,
                operation.Kind,
                blocked,
                complete,
                eventSequence,
                now,
                cancellation);
            if (complete
                && operation.Kind == LifecycleOperationKind.Delete)
            {
                await RetireTenantAddressBinding(
                    tenantAddress
                        ?? throw new InvalidOperationException(
                            "Tenant address binding was not loaded"),
                    now,
                    cancellation);
            }

            AddTenantResourceEvent(
                database,
                target.Tenant,
                ResourceEventKind.Modified,
                steps,
                now);
            return new AcceptedTargetState(
                target.Tenant.Lifecycle,
                target.Tenant.Revision.Value,
                target.Tenant.ProvisioningGeneration.Value);
        }

        var workspace = target.Workspace
            ?? throw new InvalidOperationException(
                "Lifecycle target state is invalid");
        await ApplyWorkspaceLifecycleProgress(
            workspace,
            operation.Kind,
            blocked,
            complete,
            eventSequence,
            now,
            cancellation);
        if (complete
            && operation.Kind == LifecycleOperationKind.Delete)
        {
            await RetireWorkspaceAddressBinding(
                workspaceAddress
                    ?? throw new InvalidOperationException(
                        "Workspace address binding was not loaded"),
                now,
                cancellation);
        }

        AddWorkspaceResourceEvent(
            database,
            workspace,
            ResourceEventKind.Modified,
            steps,
            now);
        return new AcceptedTargetState(
            workspace.Lifecycle,
            workspace.Revision.Value,
            workspace.ProvisioningGeneration.Value);
    }

    private sealed record TargetState(
        int ResourceKind,
        string TenantId,
        string? WorkspaceId,
        string ResourceId,
        LifecycleOperationId? CurrentOperationId,
        long ProvisioningGeneration,
        Domain.Tenants.Tenant? Tenant,
        Domain.Workspaces.Workspace? Workspace);

    private sealed record AcceptedTargetState(
        LifecycleState Lifecycle,
        long ResourceRevision,
        long ProvisioningGeneration);
}
