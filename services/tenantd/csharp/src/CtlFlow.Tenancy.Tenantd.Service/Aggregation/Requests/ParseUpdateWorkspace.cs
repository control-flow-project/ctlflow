using CtlFlow.Tenancy.Tenantd.Domain.Requests;
using CtlFlow.Tenancy.Tenantd.Domain.Workspaces;
using CtlFlow.Tenancy.Tenantd.Service.Aggregation.Documents;
using CtlFlow.Tenancy.Tenantd.Service.Aggregation.Failures;

namespace CtlFlow.Tenancy.Tenantd.Service.Aggregation.Requests;

internal static partial class AggregationRequests
{
    internal static async ValueTask<UpdateWorkspaceCommand>
        ParseUpdateWorkspace(
            WorkspaceDocument document,
            WorkspaceResource current,
            RequestActor actor,
            IdempotencyKey idempotencyKey,
            CancellationToken cancellation)
    {
        await ValidateTypeMetadata(
            document.ApiVersion,
            document.Kind,
            "Workspace",
            cancellation);
        if (!string.Equals(
                document.Metadata.Name,
                current.WorkspaceId.Value,
                StringComparison.Ordinal))
        {
            throw new InvalidFieldException(
                "metadata.name",
                "metadata.name must match the requested Workspace");
        }

        var resourceVersion = await ParseResourceVersion(
            document.Metadata.ResourceVersion,
            "metadata.resourceVersion",
            cancellation);
        var displayName = await WorkspaceDisplayName.Parse(
            document.Spec.DisplayName,
            cancellation);
        var memberships = await ParseInitialMemberships(
            document.Spec.InitialMemberships,
            cancellation);
        var packages = await ParseBaselinePackages(
            document.Spec.BaselinePackages,
            cancellation);
        if (!WorkspaceImmutableSpecMatches(
                document,
                memberships,
                packages,
                current))
        {
            throw new InvalidFieldException(
                "spec",
                "Immutable Workspace specification does not match",
                statusCode: StatusCodes.Status422UnprocessableEntity);
        }

        return new UpdateWorkspaceCommand(
            current.WorkspaceId,
            displayName,
            resourceVersion,
            actor,
            idempotencyKey,
            CalculateRequestDigest(
            [
                "update_workspace",
                current.WorkspaceId.Value,
                displayName.Value,
                resourceVersion.Value.ToString(
                    System.Globalization.CultureInfo.InvariantCulture)
            ]));
    }

    private static bool WorkspaceImmutableSpecMatches(
        WorkspaceDocument document,
        IReadOnlyList<
            Domain.Provisioning.InitialWorkspaceMembershipIntent>
            memberships,
        IReadOnlyList<Domain.Provisioning.BaselinePackageIntent> packages,
        WorkspaceResource current) =>
        string.Equals(
            document.Spec.TenantId,
            current.TenantId.Value,
            StringComparison.Ordinal)
        && string.Equals(
            document.Spec.WorkspaceAddress,
            current.Address.Value,
            StringComparison.Ordinal)
        && memberships.SequenceEqual(current.InitialMemberships)
        && packages.SequenceEqual(current.BaselinePackages)
        && (
            document.Metadata.CreationTimestamp is null
            || document.Metadata.CreationTimestamp.Value.ToUniversalTime()
                == current.CreatedAt.Value);
}
