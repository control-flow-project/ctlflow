using CtlFlow.Execution.Execd.Service.Security.Workloads;

namespace CtlFlow.Execution.Execd.Service.Configuration;

internal sealed record OperationCallerSettings(
    IReadOnlySet<KubernetesServiceAccountSubject> AutonomousCallers,
    IReadOnlySet<KubernetesServiceAccountSubject> CapabilityCallers);
