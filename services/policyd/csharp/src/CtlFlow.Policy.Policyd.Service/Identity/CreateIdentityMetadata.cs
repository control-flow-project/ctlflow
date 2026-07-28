using System.Diagnostics;
using CtlFlow.Policy.Policyd.Service.Configuration;
using CtlFlow.Policy.Policyd.Service.Security.Invocations;
using CtlFlow.Policy.Policyd.Service.Telemetry;
using Grpc.Core;

namespace CtlFlow.Policy.Policyd.Service.Identity;

internal static partial class IdentityFacts
{
    internal static async Task<Metadata> CreateIdentityMetadata(
        IdentitySettings settings,
        InvocationToken invocation,
        Activity? activity,
        CancellationToken cancellation)
    {
        var token = (await File.ReadAllTextAsync(
            settings.WorkloadTokenFilePath,
            cancellation)).Trim();
        if (token.Length is < 1 or > 16_384)
        {
            throw new IdentityUnavailableException(
                new InvalidDataException(
                    "The identity workload token is invalid"));
        }
        var headers = new Metadata
        {
            { "authorization", $"Bearer {token}" },
            {
                "ctlflow-invocation",
                $"Bearer {invocation.ReadForIdentityForwarding()}"
            }
        };
        PolicydTelemetry.AddTraceContext(headers, activity);
        return headers;
    }
}
