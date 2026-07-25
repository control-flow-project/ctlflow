using static CtlFlow.Tenancy.Tenantd.Service.Aggregation.Discovery.TenancyDiscovery;
using static CtlFlow.Tenancy.Tenantd.Service.Aggregation.Tenants.TenantRoutes;
using static CtlFlow.Tenancy.Tenantd.Service.Aggregation.Workspaces.WorkspaceRoutes;

namespace CtlFlow.Tenancy.Tenantd.Service.Aggregation;

internal static partial class AggregationHosting
{
    internal static void MapTenancyApi(WebApplication application)
    {
        var root = TenancyAggregationApi.BasePath;
        application.MapGet(root, GetTenancyDiscovery)
            .WithDisplayName("DiscoverTenancy");

        application.MapGet($"{root}/tenants", ListOrWatchTenants)
            .WithDisplayName("ListOrWatchTenants");
        application.MapPost($"{root}/tenants", CreateTenant)
            .WithDisplayName("CreateTenant");
        application.MapGet($"{root}/tenants/{{tenantId}}", GetTenant)
            .WithDisplayName("GetTenant");
        application.MapPut($"{root}/tenants/{{tenantId}}", UpdateTenant)
            .WithDisplayName("UpdateTenant");
        application.MapDelete($"{root}/tenants/{{tenantId}}", DeleteTenant)
            .WithDisplayName("DeleteTenant");
        application.MapPut(
                $"{root}/tenants/{{tenantId}}/suspend",
                SuspendTenant)
            .WithDisplayName("SuspendTenant");
        application.MapPut(
                $"{root}/tenants/{{tenantId}}/resume",
                ResumeTenant)
            .WithDisplayName("ResumeTenant");
        application.MapPut(
                $"{root}/tenants/{{tenantId}}/retry",
                RetryTenant)
            .WithDisplayName("RetryTenant");

        application.MapGet(
                $"{root}/workspaces",
                ListOrWatchWorkspaces)
            .WithDisplayName("ListOrWatchWorkspaces");
        application.MapPost($"{root}/workspaces", CreateWorkspace)
            .WithDisplayName("CreateWorkspace");
        application.MapGet(
                $"{root}/workspaces/{{workspaceId}}",
                GetWorkspace)
            .WithDisplayName("GetWorkspace");
        application.MapPut(
                $"{root}/workspaces/{{workspaceId}}",
                UpdateWorkspace)
            .WithDisplayName("UpdateWorkspace");
        application.MapDelete(
                $"{root}/workspaces/{{workspaceId}}",
                DeleteWorkspace)
            .WithDisplayName("DeleteWorkspace");
        application.MapPut(
                $"{root}/workspaces/{{workspaceId}}/suspend",
                SuspendWorkspace)
            .WithDisplayName("SuspendWorkspace");
        application.MapPut(
                $"{root}/workspaces/{{workspaceId}}/resume",
                ResumeWorkspace)
            .WithDisplayName("ResumeWorkspace");
        application.MapPut(
                $"{root}/workspaces/{{workspaceId}}/retry",
                RetryWorkspace)
            .WithDisplayName("RetryWorkspace");
    }
}
