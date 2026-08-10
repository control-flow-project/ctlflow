using CtlFlow.Auth.Authd.Domain.Identifiers;
using CtlFlow.Auth.Authd.Service.Configuration;
using CtlFlow.Auth.Authd.Service.Dependencies;
using CtlFlow.Auth.Authd.Service.Security;
using CtlFlow.Auth.Authd.Service.Telemetry;
using CtlFlow.Identity.V1;
using Grpc.Core;
using static CtlFlow.Auth.Authd.Service.Security.WorkloadAuthentication;
using static CtlFlow.Auth.Authd.Service.Telemetry.TraceContexts;

namespace CtlFlow.Auth.Authd.Service.Identity;

internal static partial class IdentityCalls
{
    private const uint ProviderAdmissionPageSize = 100;

    internal static async Task ValidateLoginProviderSelection(
        IdentityService.IdentityServiceClient client,
        WorkloadSettings workload,
        AuthdTelemetry telemetry,
        ProviderRegistration projectedProvider,
        WorkspaceId? workspaceId,
        CancellationToken cancellation)
    {
        var bearer = await ReadWorkloadBearer(
            workload,
            "identityd",
            cancellation);
        var headers = new Metadata
        {
            { "authorization", $"Bearer {bearer}" }
        };
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(
            cancellation);
        timeout.CancelAfter(TimeSpan.FromSeconds(3));
        using var activity = telemetry.StartDependency(
            "authd.identity.validate_login_provider",
            "identityd");
        InjectGrpcTraceContext(headers, activity);
        var started = System.Diagnostics.Stopwatch.GetTimestamp();
        var outcome = "unavailable";
        try
        {
            var provider = await client.GetLoginProviderAsync(
                new GetLoginProviderRequest
                {
                    TenantId = projectedProvider.TenantId.Value,
                    ProviderId = projectedProvider.ProviderId.Value
                },
                headers,
                DateTime.UtcNow.AddSeconds(3),
                timeout.Token);
            ValidateProvider(provider, projectedProvider);
            if (workspaceId is not null)
            {
                await RequireWorkspaceAdmission(
                    client,
                    headers,
                    projectedProvider,
                    workspaceId,
                    timeout.Token);
            }
            outcome = "ok";
        }
        catch (LoginProviderRejectedException)
        {
            outcome = "rejected";
            throw;
        }
        catch (DependencyUnavailableException)
        {
            throw;
        }
        catch (OperationCanceledException) when (
            cancellation.IsCancellationRequested)
        {
            outcome = "cancelled";
            throw;
        }
        catch (RpcException exception) when (
            exception.StatusCode == StatusCode.NotFound)
        {
            outcome = "rejected";
            throw new LoginProviderRejectedException(exception);
        }
        catch (Exception exception) when (
            exception is RpcException
                or InvalidDataException
                or ArgumentException
                or InvalidOperationException
                or OperationCanceledException)
        {
            throw new DependencyUnavailableException(
                "identityd",
                exception);
        }
        finally
        {
            telemetry.RecordDependency(
                activity,
                "authd.identity.validate_login_provider",
                "identityd",
                outcome,
                started);
        }
    }

    private static void ValidateProvider(
        LoginProvider provider,
        ProviderRegistration projected)
    {
        if (!string.Equals(
                provider.TenantId,
                projected.TenantId.Value,
                StringComparison.Ordinal)
            || !string.Equals(
                provider.ProviderId,
                projected.ProviderId.Value,
                StringComparison.Ordinal)
            || provider.Revision == 0)
        {
            throw new InvalidDataException(
                "Identityd returned an invalid login provider");
        }

        switch (provider.State)
        {
            case LoginProviderState.Active:
                break;
            case LoginProviderState.Disabled:
            case LoginProviderState.Deleted:
                throw new LoginProviderRejectedException();
            default:
                throw new InvalidDataException(
                    "Identityd returned an invalid login-provider state");
        }

        var expected = projected.ProjectionReference;
        if (!string.Equals(
                provider.ConfigurationId,
                expected.ConfigurationId,
                StringComparison.Ordinal)
            || !string.Equals(
                provider.ConfigurationVersionId,
                expected.ConfigurationVersionId,
                StringComparison.Ordinal)
            || !string.Equals(
                provider.SecretId,
                expected.SecretId,
                StringComparison.Ordinal)
            || !string.Equals(
                provider.SecretVersionId,
                expected.SecretVersionId,
                StringComparison.Ordinal))
        {
            throw new DependencyUnavailableException("projection");
        }
    }

    private static async Task RequireWorkspaceAdmission(
        IdentityService.IdentityServiceClient client,
        Metadata headers,
        ProviderRegistration provider,
        WorkspaceId workspaceId,
        CancellationToken cancellation)
    {
        string? after = null;
        string? previous = null;
        var admitted = false;
        do
        {
            var request = new ListWorkspaceLoginProviderAdmissionsRequest
            {
                TenantId = provider.TenantId.Value,
                WorkspaceId = workspaceId.Value,
                PageSize = ProviderAdmissionPageSize
            };
            if (after is not null)
            {
                request.AfterProviderId = after;
            }
            var response =
                await client.ListWorkspaceLoginProviderAdmissionsAsync(
                    request,
                    headers,
                    DateTime.UtcNow.AddSeconds(3),
                    cancellation);
            if (response.Admissions.Count > ProviderAdmissionPageSize)
            {
                throw new InvalidDataException(
                    "Identityd returned an oversized provider-admission page");
            }
            foreach (var admission in response.Admissions)
            {
                if (!string.Equals(
                        admission.TenantId,
                        provider.TenantId.Value,
                        StringComparison.Ordinal)
                    || !string.Equals(
                        admission.WorkspaceId,
                        workspaceId.Value,
                        StringComparison.Ordinal))
                {
                    throw new InvalidDataException(
                        "Identityd returned a foreign provider admission");
                }
                var providerId = ProviderId.Parse(admission.ProviderId).Value;
                if (previous is not null
                    && string.CompareOrdinal(previous, providerId) >= 0)
                {
                    throw new InvalidDataException(
                        "Identityd returned an unordered provider-admission page");
                }
                previous = providerId;
                admitted |= string.Equals(
                    providerId,
                    provider.ProviderId.Value,
                    StringComparison.Ordinal);
            }

            if (!response.HasNextAfterProviderId)
            {
                after = null;
                continue;
            }
            var next = ProviderId.Parse(
                response.NextAfterProviderId).Value;
            if (previous is null
                || !string.Equals(next, previous, StringComparison.Ordinal)
                || after is not null
                    && string.CompareOrdinal(after, next) >= 0)
            {
                throw new InvalidDataException(
                    "Identityd returned an invalid provider continuation");
            }
            after = next;
        } while (after is not null);

        if (!admitted)
        {
            throw new LoginProviderRejectedException();
        }
    }
}
