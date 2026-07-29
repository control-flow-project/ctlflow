namespace CtlFlow.Execution.Execd.Service.Kubernetes;

internal static class KubernetesResourcePaths
{
    internal static string Namespace(string namespaceName) =>
        $"/api/v1/namespaces/{namespaceName}";

    internal static string ServiceAccount(
        string namespaceName,
        string accountName) =>
        $"/api/v1/namespaces/{namespaceName}/serviceaccounts/{accountName}";

    internal static string Secret(
        string namespaceName,
        string secretName) =>
        $"/api/v1/namespaces/{namespaceName}/secrets/{secretName}";

    internal static string ConfigMap(
        string namespaceName,
        string configMapName) =>
        $"/api/v1/namespaces/{namespaceName}/configmaps/{configMapName}";

    internal static string PersistentVolumeClaim(
        string namespaceName,
        string claimName) =>
        $"/api/v1/namespaces/{namespaceName}/persistentvolumeclaims/{claimName}";

    internal static string Service(
        string namespaceName,
        string serviceName) =>
        $"/api/v1/namespaces/{namespaceName}/services/{serviceName}";

    internal static string Deployment(
        string namespaceName,
        string deploymentName) =>
        $"/apis/apps/v1/namespaces/{namespaceName}/deployments/{deploymentName}";

    internal static string Job(
        string namespaceName,
        string jobName) =>
        $"/apis/batch/v1/namespaces/{namespaceName}/jobs/{jobName}";

    internal static string DependencyClaim(
        string namespaceName,
        string claimName) =>
        $"/apis/execution.ctlflow.io/v1/namespaces/{namespaceName}"
        + $"/dependencyclaims/{claimName}";
}
