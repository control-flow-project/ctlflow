using CtlFlow.Tenancy.Tenantd.Domain.Provisioning;
using CtlFlow.Tenancy.Tenantd.Domain.Workspaces;
using CtlFlow.Tenancy.Tenantd.Service.Aggregation.Documents;

namespace CtlFlow.Tenancy.Tenantd.Service.Aggregation.Responses;

internal static partial class AggregationResponses
{
    internal static WorkspaceDocument CreateWorkspaceDocument(
        WorkspaceResource resource) =>
        new()
        {
            ApiVersion = "tenancy.ctlflow.com/v1alpha1",
            Kind = "Workspace",
            Metadata = new ObjectMetaDocument
            {
                Name = resource.WorkspaceId.Value,
                ResourceVersion =
                    resource.ResourceVersion.Value.ToString(
                        System.Globalization.CultureInfo.InvariantCulture),
                CreationTimestamp = resource.CreatedAt.Value
            },
            Spec = new WorkspaceSpecDocument
            {
                TenantId = resource.TenantId.Value,
                DisplayName = resource.DisplayName.Value,
                WorkspaceAddress = resource.Address.Value,
                InitialMemberships = resource.InitialMemberships
                    .Select(membership => new InitialMembershipDocument
                    {
                        UserId = membership.UserId.Value,
                        Standing = membership.Standing switch
                        {
                            MembershipStanding.Admin => "admin",
                            MembershipStanding.Member => "member",
                            _ => throw new InvalidOperationException(
                                "Membership standing is invalid")
                        }
                    })
                    .ToArray(),
                BaselinePackages = resource.BaselinePackages
                    .Select(package => new BaselinePackageDocument
                    {
                        PackageId = package.PackageId.Value,
                        PackageVersion = package.PackageVersion.Value
                    })
                    .ToArray()
            },
            Status = CreateResourceStatusDocument(
                resource.Lifecycle,
                resource.Revision.Value,
                resource.ProvisioningGeneration.Value,
                resource.CurrentOperationId,
                resource.CurrentOperationKind,
                resource.Conditions)
        };
}
