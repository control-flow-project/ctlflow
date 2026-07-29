namespace CtlFlow.Edge.Edged.Service.Identity;

internal static partial class SessionExchange
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
                "Identity workload token is invalid");
    }
}
