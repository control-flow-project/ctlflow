using CtlFlow.Auth.Authd.Service.Dependencies;

namespace CtlFlow.Auth.Authd.Service.Identity;

internal static partial class IdentityCalls
{
    internal static async Task<string> ReadWorkloadBearer(
        string path,
        CancellationToken cancellation)
    {
        try
        {
            var value = (await File.ReadAllTextAsync(
                path,
                cancellation)).Trim();
            if (value.Length is < 1 or > 16_384
                || value.Any(character => character > 0x7f))
            {
                throw new InvalidDataException(
                    "Workload bearer is invalid");
            }
            return value;
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception exception) when (
            exception is IOException
                or UnauthorizedAccessException
                or InvalidDataException)
        {
            throw new DependencyUnavailableException(
                "identityd",
                exception);
        }
    }
}
