using CtlFlow.Configuration.Configd.Domain.Bindings;
using CtlFlow.Configuration.Configd.Domain.Claims;
using CtlFlow.Configuration.Configd.Service.Security;
using CtlFlow.Configuration.Configd.Service.Security.Callers;

namespace CtlFlow.Configuration.Configd.Service.Kubernetes;

internal static partial class KubernetesApis
{
    internal static async Task ValidatePublicationAdmission(
        KubernetesApi api,
        ConfigRequestIdentity identity,
        DependencyClaimSelector? selector,
        ConsumerBinding binding,
        CancellationToken cancellation)
    {
        switch (identity.Admission)
        {
            case ConfigAdmission.Operator or ConfigAdmission.Capability:
                if (selector is not null)
                {
                    throw new ArgumentException(
                        "Dependency claim selector is not admitted");
                }

                return;
            case ConfigAdmission.Provisioner
                when selector is not null
                && identity.ImmediateCaller
                    is AuthenticatedConfigCaller.Workload workload:
                if (binding.Placement.Scope is PlacementScope.Global)
                {
                    throw new CallerNotAdmittedException();
                }

                await ValidateDependencyClaim(
                    api,
                    selector,
                    binding,
                    workload.Subject,
                    cancellation);
                return;
            case ConfigAdmission.Provisioner:
                throw new ArgumentException(
                    "Dependency claim selector is required");
            default:
                throw new CallerNotAdmittedException();
        }
    }
}
