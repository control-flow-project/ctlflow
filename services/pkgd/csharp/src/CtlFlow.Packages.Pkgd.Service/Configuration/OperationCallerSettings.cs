using CtlFlow.Packages.Pkgd.Service.Security.Workloads;

namespace CtlFlow.Packages.Pkgd.Service.Configuration;

internal sealed record OperationCallerSettings(
    IReadOnlySet<KubernetesServiceAccountSubject> AutonomousCallers,
    IReadOnlySet<KubernetesServiceAccountSubject> CapabilityCallers);
