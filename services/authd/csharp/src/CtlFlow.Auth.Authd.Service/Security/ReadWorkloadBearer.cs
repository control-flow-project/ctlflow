using CtlFlow.Auth.Authd.Service.Configuration;
using CtlFlow.Auth.Authd.Service.Dependencies;

namespace CtlFlow.Auth.Authd.Service.Security;

internal static partial class WorkloadAuthentication
{
    internal static async Task<string> ReadWorkloadBearer(
        WorkloadSettings settings,
        string dependency,
        CancellationToken cancellation)
    {
        try
        {
            var value = (await File.ReadAllTextAsync(
                settings.TokenPath,
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
                dependency,
                exception);
        }
    }
}
