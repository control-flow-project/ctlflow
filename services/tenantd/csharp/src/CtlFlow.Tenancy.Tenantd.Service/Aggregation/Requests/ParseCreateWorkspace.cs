using CtlFlow.Tenancy.Tenantd.Domain.Requests;
using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.Tenantd.Domain.Workspaces;
using CtlFlow.Tenancy.Tenantd.Service.Aggregation.Documents;
using CtlFlow.Tenancy.Tenantd.Service.Aggregation.Failures;

namespace CtlFlow.Tenancy.Tenantd.Service.Aggregation.Requests;

internal static partial class AggregationRequests
{
    internal static async ValueTask<CreateWorkspaceCommand>
        ParseCreateWorkspace(
            WorkspaceDocument document,
            RequestActor actor,
            IdempotencyKey idempotencyKey,
            CancellationToken cancellation)
    {
        await ValidateTypeMetadata(
            document.ApiVersion,
            document.Kind,
            "Workspace",
            cancellation);
        if (document.Status is not null
            || document.Metadata.Name is not null
            || document.Metadata.ResourceVersion is not null
            || document.Metadata.CreationTimestamp is not null)
        {
            throw new InvalidFieldException(
                "metadata",
                "Create cannot supply server-owned metadata or status");
        }

        try
        {
            var tenantId = await TenantId.Parse(
                document.Spec.TenantId,
                cancellation);
            var displayName = await WorkspaceDisplayName.Parse(
                document.Spec.DisplayName,
                cancellation);
            var address = await WorkspaceAddress.Parse(
                document.Spec.WorkspaceAddress,
                cancellation);
            var memberships = await ParseInitialMemberships(
                document.Spec.InitialMemberships,
                cancellation);
            var packages = await ParseBaselinePackages(
                document.Spec.BaselinePackages,
                cancellation);
            var digestFields = new List<string>
            {
                "create_workspace",
                tenantId.Value,
                displayName.Value,
                address.Value,
                memberships.Count.ToString(
                    System.Globalization.CultureInfo.InvariantCulture)
            };
            foreach (var membership in memberships)
            {
                digestFields.Add(membership.UserId.Value);
                digestFields.Add(
                    ((int)membership.Standing).ToString(
                        System.Globalization.CultureInfo.InvariantCulture));
            }

            digestFields.Add(packages.Count.ToString(
                System.Globalization.CultureInfo.InvariantCulture));
            foreach (var package in packages)
            {
                digestFields.Add(package.PackageId.Value);
                digestFields.Add(package.PackageVersion.Value);
            }

            return new CreateWorkspaceCommand(
                tenantId,
                displayName,
                address,
                memberships,
                packages,
                actor,
                idempotencyKey,
                CalculateRequestDigest(digestFields));
        }
        catch (ArgumentException exception)
        {
            throw new InvalidFieldException("spec", exception.Message);
        }
    }
}
