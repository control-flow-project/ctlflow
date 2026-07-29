namespace CtlFlow.Execution.Execd.Service.Kubernetes;

internal static partial class KubernetesApis
{
    internal static async Task<bool> VerifyKubernetesCredentials(
        KubernetesApi api,
        CancellationToken cancellation)
    {
        try
        {
            var token = (await File.ReadAllTextAsync(
                api.Settings.TokenFilePath,
                cancellation)).Trim();
            return token.Length is >= 1 and <= 16_384;
        }
        catch (Exception exception) when (
            exception is IOException
                or UnauthorizedAccessException)
        {
            return false;
        }
    }
}
