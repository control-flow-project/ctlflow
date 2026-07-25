using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.Tenantd.Service.Aggregation.Documents;

namespace CtlFlow.Tenancy.Tenantd.Service.Aggregation.Responses;

internal static partial class AggregationResponses
{
    internal static TenantDocument CreateTenantDocument(
        TenantResource resource) =>
        new()
        {
            ApiVersion = "tenancy.ctlflow.com/v1alpha1",
            Kind = "Tenant",
            Metadata = new ObjectMetaDocument
            {
                Name = resource.TenantId.Value,
                ResourceVersion =
                    resource.ResourceVersion.Value.ToString(
                        System.Globalization.CultureInfo.InvariantCulture),
                CreationTimestamp = resource.CreatedAt.Value
            },
            Spec = new TenantSpecDocument
            {
                DisplayName = resource.DisplayName.Value,
                Address = new ExternalTenantAddressDocument
                {
                    Authority = resource.Authority.Value,
                    PathPrefix = resource.PathPrefix.Value
                },
                InitialAdministrator = new InitialAdministratorDocument
                {
                    DisplayName =
                        resource.InitialAdministrator.DisplayName.Value,
                    LoginIdentifier =
                        resource.InitialAdministrator.LoginIdentifier.Value,
                    IdentityLink =
                        resource.InitialAdministrator.IdentityLink is
                            { } identityLink
                            ? new IdentityLinkDeclarationDocument
                            {
                                ProviderId =
                                    identityLink.ProviderId.Value,
                                ProviderSubject =
                                    identityLink.ProviderSubject.Value
                            }
                            : null
                },
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
