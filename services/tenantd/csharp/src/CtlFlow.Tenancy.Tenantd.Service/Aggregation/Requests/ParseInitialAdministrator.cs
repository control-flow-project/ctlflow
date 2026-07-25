using CtlFlow.Tenancy.Tenantd.Domain.Provisioning;
using CtlFlow.Tenancy.Tenantd.Service.Aggregation.Documents;
using CtlFlow.Tenancy.Tenantd.Service.Aggregation.Failures;

namespace CtlFlow.Tenancy.Tenantd.Service.Aggregation.Requests;

internal static partial class AggregationRequests
{
    internal static async ValueTask<InitialAdministratorIntent>
        ParseInitialAdministrator(
            InitialAdministratorDocument document,
            CancellationToken cancellation)
    {
        try
        {
            var displayName = await AdministratorDisplayName.Parse(
                document.DisplayName,
                cancellation);
            var loginIdentifier = await LoginIdentifier.Parse(
                document.LoginIdentifier,
                cancellation);
            IdentityLinkIntent? identityLink = null;
            if (document.IdentityLink is { } link)
            {
                identityLink = new IdentityLinkIntent(
                    await IdentityProviderId.Parse(
                        link.ProviderId,
                        cancellation),
                    await ProviderSubject.Parse(
                        link.ProviderSubject,
                        cancellation));
            }

            return new InitialAdministratorIntent(
                displayName,
                loginIdentifier,
                identityLink);
        }
        catch (ArgumentException exception)
        {
            throw new InvalidFieldException(
                "spec.initialAdministrator",
                exception.Message);
        }
    }
}
