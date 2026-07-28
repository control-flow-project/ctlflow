using CtlFlow.Configuration.Configd.Service.Security.Workloads;

namespace CtlFlow.Configuration.Configd.Service.Configuration;

internal sealed record OperationCallerSettings(
    IReadOnlySet<KubernetesServiceAccountSubject> AutonomousCallers,
    IReadOnlySet<KubernetesServiceAccountSubject> CapabilityCallers);
