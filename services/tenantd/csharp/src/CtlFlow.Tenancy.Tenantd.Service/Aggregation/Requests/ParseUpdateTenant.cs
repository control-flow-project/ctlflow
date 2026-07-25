using CtlFlow.Tenancy.Tenantd.Domain.Requests;
using CtlFlow.Tenancy.Tenantd.Domain.Sequences;
using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.Tenantd.Service.Aggregation.Documents;
using CtlFlow.Tenancy.Tenantd.Service.Aggregation.Failures;

namespace CtlFlow.Tenancy.Tenantd.Service.Aggregation.Requests;

internal static partial class AggregationRequests
{
    internal static async ValueTask<UpdateTenantCommand> ParseUpdateTenant(
        TenantDocument document,
        TenantResource current,
        RequestActor actor,
        IdempotencyKey idempotencyKey,
        CancellationToken cancellation)
    {
        await ValidateTypeMetadata(
            document.ApiVersion,
            document.Kind,
            "Tenant",
            cancellation);
        if (!string.Equals(
                document.Metadata.Name,
                current.TenantId.Value,
                StringComparison.Ordinal))
        {
            throw new InvalidFieldException(
                "metadata.name",
                "metadata.name must match the requested Tenant");
        }

        var resourceVersion = await ParseResourceVersion(
            document.Metadata.ResourceVersion,
            "metadata.resourceVersion",
            cancellation);
        var displayName = await TenantDisplayName.Parse(
            document.Spec.DisplayName,
            cancellation);
        var administrator = await ParseInitialAdministrator(
            document.Spec.InitialAdministrator,
            cancellation);
        var packages = await ParseBaselinePackages(
            document.Spec.BaselinePackages,
            cancellation);
        if (!TenantImmutableSpecMatches(
                document,
                administrator,
                packages,
                current))
        {
            throw new InvalidFieldException(
                "spec",
                "Immutable Tenant specification does not match",
                statusCode: StatusCodes.Status422UnprocessableEntity);
        }

        return new UpdateTenantCommand(
            current.TenantId,
            displayName,
            resourceVersion,
            actor,
            idempotencyKey,
            CalculateRequestDigest(
            [
                "update_tenant",
                current.TenantId.Value,
                displayName.Value,
                resourceVersion.Value.ToString(
                    System.Globalization.CultureInfo.InvariantCulture)
            ]));
    }

    private static bool TenantImmutableSpecMatches(
        TenantDocument document,
        Domain.Provisioning.InitialAdministratorIntent administrator,
        IReadOnlyList<Domain.Provisioning.BaselinePackageIntent> packages,
        TenantResource current) =>
        string.Equals(
            document.Spec.Address.Authority,
            current.Authority.Value,
            StringComparison.Ordinal)
        && string.Equals(
            document.Spec.Address.PathPrefix,
            current.PathPrefix.Value,
            StringComparison.Ordinal)
        && administrator == current.InitialAdministrator
        && packages.SequenceEqual(current.BaselinePackages)
        && (
            document.Metadata.CreationTimestamp is null
            || document.Metadata.CreationTimestamp.Value.ToUniversalTime()
                == current.CreatedAt.Value);
}
