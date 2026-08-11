namespace CtlFlow.Execution.Execd.Service.Kubernetes;

internal sealed record DeploymentStatus(
    int AvailableReplicas,
    int Replicas,
    int UpdatedReplicas,
    long Generation,
    long ObservedGeneration);
