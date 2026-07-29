namespace CtlFlow.Execution.Execd.Service.Dependencies;

internal static partial class DependencyAuthentication
{
    internal static async ValueTask<string> ReadWorkloadToken(
        string path,
        CancellationToken cancellation)
    {
        var token = (await File.ReadAllTextAsync(
            path,
            cancellation)).Trim();
        return token.Length is >= 1 and <= 16_384
            ? token
            : throw new InvalidDataException(
                "Dependency workload token is invalid");
    }
}
