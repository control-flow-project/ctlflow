using CtlFlow.Tenancy.Tenantd.Service.Security.Workloads;

namespace CtlFlow.Tenancy.Tenantd.Service.Configuration;

internal sealed record OperationCallerSettings(
    IReadOnlySet<KubernetesServiceAccountSubject> AutonomousCallers,
    IReadOnlySet<KubernetesServiceAccountSubject> CapabilityCallers);
