namespace CtlFlow.Execution.Execd.Service.Kubernetes;

internal sealed class KubernetesUnavailableException(Exception inner)
    : Exception("Kubernetes operation is unavailable", inner)
{
}
