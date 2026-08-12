using CtlFlow.Auth.Authd.Domain.Identifiers;
using CtlFlow.Auth.Authd.Service.Configuration;
using CtlFlow.Auth.Authd.Service.Dependencies;
using CtlFlow.Auth.Authd.Service.Identity;
using CtlFlow.Auth.Authd.Service.Security;
using CtlFlow.Auth.Authd.Service.Telemetry;
using CtlFlow.Tenancy.V1;
using Grpc.Core;
using static CtlFlow.Auth.Authd.Service.Security.WorkloadAuthentication;
using static CtlFlow.Auth.Authd.Service.Telemetry.TraceContexts;

namespace CtlFlow.Auth.Authd.Service.Tenancy;

internal static partial class TenantCalls
{
    internal static async Task ValidateLoginTarget(
        TenantService.TenantServiceClient client,
        WorkloadSettings workload,
        AuthdTelemetry telemetry,
        TenantId tenantId,
        WorkspaceId? workspaceId,
        CancellationToken cancellation)
    {
        var bearer = await ReadWorkloadBearer(
            workload,
            "tenantd",
            cancellation);
        var headers = new Metadata
        {
            { "authorization", $"Bearer {bearer}" }
        };
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(
            cancellation);
        timeout.CancelAfter(TimeSpan.FromSeconds(3));
        using var activity = telemetry.StartDependency(
            "authd.tenant.validate_login_target",
            "tenantd");
        InjectGrpcTraceContext(headers, activity);
        var started = System.Diagnostics.Stopwatch.GetTimestamp();
        var outcome = "unavailable";
        try
        {
            var tenant = await client.GetTenantAsync(
                new GetTenantRequest { TenantId = tenantId.Value },
                headers,
                DateTime.UtcNow.AddSeconds(3),
                timeout.Token);
            ValidateTenant(tenant, tenantId);
            if (workspaceId is not null)
            {
                var workspace = await client.GetWorkspaceAsync(
                    new GetWorkspaceRequest
                    {
                        WorkspaceId = workspaceId.Value
                    },
                    headers,
                    DateTime.UtcNow.AddSeconds(3),
                    timeout.Token);
                ValidateWorkspace(workspace, tenantId, workspaceId);
            }
            outcome = "ok";
        }
        catch (LoginProviderRejectedException)
        {
            outcome = "rejected";
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
                "tenantd",
                exception);
        }
        finally
        {
            telemetry.RecordDependency(
                activity,
                "authd.tenant.validate_login_target",
                "tenantd",
                outcome,
                started);
        }
    }

    private static void ValidateTenant(
        Tenant tenant,
        TenantId expectedTenantId)
    {
        if (!string.Equals(
                tenant.TenantId,
                expectedTenantId.Value,
                StringComparison.Ordinal)
            || tenant.Revision == 0)
        {
            throw new InvalidDataException(
                "Tenantd returned an invalid Tenant");
        }

        ValidateActiveState(tenant.State);
    }

    private static void ValidateWorkspace(
        Workspace workspace,
        TenantId expectedTenantId,
        WorkspaceId expectedWorkspaceId)
    {
        if (!string.Equals(
                workspace.WorkspaceId,
                expectedWorkspaceId.Value,
                StringComparison.Ordinal)
            || workspace.Revision == 0)
        {
            throw new InvalidDataException(
                "Tenantd returned an invalid Workspace");
        }
        if (!string.Equals(
                workspace.TenantId,
                expectedTenantId.Value,
                StringComparison.Ordinal))
        {
            throw new LoginProviderRejectedException();
        }

        ValidateActiveState(workspace.State);
    }

    private static void ValidateActiveState(ResourceState state)
    {
        switch (state)
        {
            case ResourceState.Active:
                return;
            case ResourceState.Suspended:
            case ResourceState.Deleted:
                throw new LoginProviderRejectedException();
            default:
                throw new InvalidDataException(
                    "Tenantd returned an invalid lifecycle state");
        }
    }
}
