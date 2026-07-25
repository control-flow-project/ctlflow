using CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;
using CtlFlow.Tenancy.Tenantd.Domain.Requests;
using CtlFlow.Tenancy.Tenantd.Domain.Workspaces;
using CtlFlow.Tenancy.Tenantd.Service.Aggregation.Documents;

namespace CtlFlow.Tenancy.Tenantd.Service.Aggregation.Requests;

internal static partial class AggregationRequests
{
    internal static async ValueTask<LifecycleActionCommand>
        ParseWorkspaceLifecycleAction(
            WorkspaceResource workspace,
            LifecycleActionDocument document,
            LifecycleOperationKind operation,
            RequestActor actor,
            IdempotencyKey idempotencyKey,
            CancellationToken cancellation)
    {
        await ValidateTypeMetadata(
            document.ApiVersion,
            document.Kind,
            "LifecycleAction",
            cancellation);
        var resourceVersion = await ParseResourceVersion(
            document.ResourceVersion,
            "resourceVersion",
            cancellation);
        return new LifecycleActionCommand(
            new LifecycleTarget.Workspace(
                workspace.TenantId,
                workspace.WorkspaceId),
            operation,
            resourceVersion,
            actor,
            idempotencyKey,
            CalculateRequestDigest(
            [
                "workspace_lifecycle",
                workspace.TenantId.Value,
                workspace.WorkspaceId.Value,
                ((int)operation).ToString(
                    System.Globalization.CultureInfo.InvariantCulture),
                resourceVersion.Value.ToString(
                    System.Globalization.CultureInfo.InvariantCulture)
            ]));
    }
}
