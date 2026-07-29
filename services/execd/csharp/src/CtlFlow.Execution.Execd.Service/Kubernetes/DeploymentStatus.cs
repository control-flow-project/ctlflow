namespace CtlFlow.Execution.Execd.Service.Kubernetes;

internal sealed record DeploymentStatus(
    int AvailableReplicas,
    long Generation,
    long ObservedGeneration);
