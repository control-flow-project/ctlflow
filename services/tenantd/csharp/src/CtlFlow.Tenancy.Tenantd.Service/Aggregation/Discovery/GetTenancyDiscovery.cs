using CtlFlow.Tenancy.Tenantd.Service.Aggregation.Documents;
using static CtlFlow.Tenancy.Tenantd.Service.Aggregation.Serialization.AggregationJson;

namespace CtlFlow.Tenancy.Tenantd.Service.Aggregation.Discovery;

internal static class TenancyDiscovery
{
    internal static Task GetTenancyDiscovery(HttpContext context)
    {
        var json = context.RequestServices.GetRequiredService<
            TenancyJsonContext>();
        return WriteJsonDocument(
            context.Response,
            StatusCodes.Status200OK,
            new ApiResourceListDocument
            {
                ApiVersion = "v1",
                GroupVersion = "tenancy.ctlflow.com/v1alpha1",
                Kind = "APIResourceList",
                Resources =
                [
                    Resource(
                        "tenants",
                        "tenant",
                        "Tenant",
                        "get",
                        "list",
                        "watch",
                        "create",
                        "update",
                        "delete"),
                    Resource(
                        "tenants/suspend",
                        string.Empty,
                        "Tenant",
                        "update"),
                    Resource(
                        "tenants/resume",
                        string.Empty,
                        "Tenant",
                        "update"),
                    Resource(
                        "tenants/retry",
                        string.Empty,
                        "Tenant",
                        "update"),
                    Resource(
                        "workspaces",
                        "workspace",
                        "Workspace",
                        "get",
                        "list",
                        "watch",
                        "create",
                        "update",
                        "delete"),
                    Resource(
                        "workspaces/suspend",
                        string.Empty,
                        "Workspace",
                        "update"),
                    Resource(
                        "workspaces/resume",
                        string.Empty,
                        "Workspace",
                        "update"),
                    Resource(
                        "workspaces/retry",
                        string.Empty,
                        "Workspace",
                        "update")
                ]
            },
            json.ApiResourceListDocument,
            context.RequestAborted);
    }

    private static ApiResourceDocument Resource(
        string name,
        string singularName,
        string kind,
        params string[] verbs) =>
        new()
        {
            Name = name,
            SingularName = singularName,
            Namespaced = false,
            Kind = kind,
            Verbs = verbs
        };
}
