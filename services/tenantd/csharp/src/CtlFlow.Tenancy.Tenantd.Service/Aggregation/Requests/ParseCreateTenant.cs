using CtlFlow.Tenancy.Tenantd.Domain.Addresses;
using CtlFlow.Tenancy.Tenantd.Domain.Requests;
using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.Tenantd.Service.Aggregation.Documents;
using CtlFlow.Tenancy.Tenantd.Service.Aggregation.Failures;

namespace CtlFlow.Tenancy.Tenantd.Service.Aggregation.Requests;

internal static partial class AggregationRequests
{
    internal static async ValueTask<CreateTenantCommand> ParseCreateTenant(
        TenantDocument document,
        RequestActor actor,
        IdempotencyKey idempotencyKey,
        CancellationToken cancellation)
    {
        await ValidateTypeMetadata(
            document.ApiVersion,
            document.Kind,
            "Tenant",
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
            var displayName = await TenantDisplayName.Parse(
                document.Spec.DisplayName,
                cancellation);
            var authority = await ExternalAuthority.Parse(
                document.Spec.Address.Authority,
                cancellation);
            var pathPrefix = await TenantPathPrefix.Parse(
                document.Spec.Address.PathPrefix,
                cancellation);
            var administrator = await ParseInitialAdministrator(
                document.Spec.InitialAdministrator,
                cancellation);
            var packages = await ParseBaselinePackages(
                document.Spec.BaselinePackages,
                cancellation);
            var digestFields = new List<string>
            {
                "create_tenant",
                displayName.Value,
                authority.Value,
                pathPrefix.Value,
                administrator.DisplayName.Value,
                administrator.LoginIdentifier.Value,
                administrator.IdentityLink is null ? "0" : "1",
                administrator.IdentityLink?.ProviderId.Value ?? string.Empty,
                administrator.IdentityLink?.ProviderSubject.Value
                    ?? string.Empty,
                packages.Count.ToString(
                    System.Globalization.CultureInfo.InvariantCulture)
            };
            foreach (var package in packages)
            {
                digestFields.Add(package.PackageId.Value);
                digestFields.Add(package.PackageVersion.Value);
            }

            return new CreateTenantCommand(
                displayName,
                authority,
                pathPrefix,
                administrator,
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
