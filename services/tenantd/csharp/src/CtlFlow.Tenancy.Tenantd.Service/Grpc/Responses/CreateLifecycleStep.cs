using DomainLifecycleOperationKind =
    CtlFlow.Tenancy.Tenantd.Domain.Lifecycles.LifecycleOperationKind;
using DomainLifecycleProvisioningIntent =
    CtlFlow.Tenancy.Tenantd.Domain.Lifecycles.LifecycleProvisioningIntent;
using DomainLifecycleStepKey =
    CtlFlow.Tenancy.Tenantd.Domain.Lifecycles.LifecycleStepKey;
using DomainLifecycleWorkItem =
    CtlFlow.Tenancy.Tenantd.Domain.Lifecycles.LifecycleWorkItem;
using DomainMembershipStanding =
    CtlFlow.Tenancy.Tenantd.Domain.Provisioning.MembershipStanding;
using WireBaselinePackage = CtlFlow.Tenancy.V1.BaselinePackage;
using WireIdentityLifecycleIntent =
    CtlFlow.Tenancy.V1.IdentityLifecycleIntent;
using WireIdentityLinkDeclaration =
    CtlFlow.Tenancy.V1.IdentityLinkDeclaration;
using WireInitialAdministrator = CtlFlow.Tenancy.V1.InitialAdministrator;
using WireInitialWorkspaceMembership =
    CtlFlow.Tenancy.V1.InitialWorkspaceMembership;
using WireLifecycleOperationKind =
    CtlFlow.Tenancy.V1.LifecycleOperationKind;
using WireLifecycleStep = CtlFlow.Tenancy.V1.LifecycleStep;
using WireLifecycleStepKey = CtlFlow.Tenancy.V1.LifecycleStepKey;
using WireMembershipStanding = CtlFlow.Tenancy.V1.MembershipStanding;
using WirePackageLifecycleIntent =
    CtlFlow.Tenancy.V1.PackageLifecycleIntent;

namespace CtlFlow.Tenancy.Tenantd.Service.Grpc.Responses;

internal static partial class LifecycleResponses
{
    internal static WireLifecycleStep CreateLifecycleStep(
        DomainLifecycleWorkItem item)
    {
        var response = new WireLifecycleStep
        {
            Target = CreateLifecycleTarget(item.Target),
            LifecycleOperationId = item.OperationId.Value,
            ProvisioningGeneration =
                checked((ulong)item.ProvisioningGeneration),
            Operation = MapLifecycleOperationKind(item.Operation),
            StepKey = MapLifecycleStepKey(item.StepKey),
            State = MapLifecycleStepState(item.StepState),
            StepRevision = checked((ulong)item.StepRevision.Value)
        };
        if (item.BlockedReason is { } blockedReason)
        {
            response.BlockedReason = blockedReason.Value;
        }

        switch (item.ProvisioningIntent)
        {
            case DomainLifecycleProvisioningIntent.Identity identity:
                response.Identity = CreateIdentityIntent(identity);
                break;
            case DomainLifecycleProvisioningIntent.Packages packages:
                response.Packages = CreatePackageIntent(packages);
                break;
        }

        return response;
    }

    private static WireIdentityLifecycleIntent CreateIdentityIntent(
        DomainLifecycleProvisioningIntent.Identity intent)
    {
        var response = new WireIdentityLifecycleIntent();
        if (intent.InitialAdministrator is { } administrator)
        {
            response.InitialAdministrator = new WireInitialAdministrator
            {
                DisplayName = administrator.DisplayName.Value,
                LoginIdentifier = administrator.LoginIdentifier.Value
            };
            if (administrator.IdentityLink is { } identityLink)
            {
                response.InitialAdministrator.IdentityLink =
                    new WireIdentityLinkDeclaration
                    {
                        ProviderId = identityLink.ProviderId.Value,
                        ProviderSubject =
                            identityLink.ProviderSubject.Value
                    };
            }
        }

        response.WorkspaceMemberships.AddRange(
            intent.WorkspaceMemberships.Select(value =>
                new WireInitialWorkspaceMembership
                {
                    UserId = value.UserId.Value,
                    Standing = value.Standing switch
                    {
                        DomainMembershipStanding.Admin =>
                            WireMembershipStanding.Admin,
                        DomainMembershipStanding.Member =>
                            WireMembershipStanding.Member,
                        _ => throw new InvalidOperationException(
                            "Membership standing is invalid")
                    }
                }));
        return response;
    }

    private static WirePackageLifecycleIntent CreatePackageIntent(
        DomainLifecycleProvisioningIntent.Packages intent)
    {
        var response = new WirePackageLifecycleIntent();
        response.BaselinePackages.AddRange(
            intent.BaselinePackages.Select(value => new WireBaselinePackage
            {
                PackageId = value.PackageId.Value,
                PackageVersion = value.PackageVersion.Value
            }));
        return response;
    }

    private static WireLifecycleOperationKind MapLifecycleOperationKind(
        DomainLifecycleOperationKind operation) =>
        operation switch
        {
            DomainLifecycleOperationKind.Provision =>
                WireLifecycleOperationKind.Provision,
            DomainLifecycleOperationKind.Suspend =>
                WireLifecycleOperationKind.Suspend,
            DomainLifecycleOperationKind.Resume =>
                WireLifecycleOperationKind.Resume,
            DomainLifecycleOperationKind.Delete =>
                WireLifecycleOperationKind.Delete,
            _ => throw new InvalidOperationException(
                "Lifecycle operation is invalid")
        };

    private static WireLifecycleStepKey MapLifecycleStepKey(
        DomainLifecycleStepKey stepKey) =>
        stepKey switch
        {
            DomainLifecycleStepKey.Identity =>
                WireLifecycleStepKey.Identity,
            DomainLifecycleStepKey.Configuration =>
                WireLifecycleStepKey.Configuration,
            DomainLifecycleStepKey.Execution =>
                WireLifecycleStepKey.Execution,
            DomainLifecycleStepKey.Packages =>
                WireLifecycleStepKey.Packages,
            _ => throw new InvalidOperationException(
                "Lifecycle step key is invalid")
        };

}
