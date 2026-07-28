using CtlFlow.Configuration.Configd.Domain.Bindings;
using V1 = CtlFlow.Configuration.V1;

namespace CtlFlow.Configuration.Configd.Service.Grpc.Responses;

internal static partial class ConfigdResponses
{
    internal static V1.ConsumerBinding CreateConsumerBindingResponse(
        ConsumerBinding binding)
    {
        var placement = new V1.PlacementBinding
        {
            PlacementId = binding.Placement.PlacementId.Value
        };
        switch (binding.Placement.Scope)
        {
            case PlacementScope.Global:
                placement.Global = new V1.GlobalPlacementScope();
                break;
            case PlacementScope.Tenant tenant:
                placement.Tenant = new V1.TenantPlacementScope
                {
                    TenantId = tenant.TenantId.Value
                };
                break;
            case PlacementScope.Workspace workspace:
                placement.Workspace = new V1.WorkspacePlacementScope
                {
                    TenantId = workspace.TenantId.Value,
                    WorkspaceId = workspace.WorkspaceId.Value
                };
                break;
            case PlacementScope.User user:
                placement.User = new V1.UserPlacementScope
                {
                    TenantId = user.TenantId.Value,
                    AccountPrincipalId = user.AccountPrincipalId.Value
                };
                break;
            default:
                throw new InvalidOperationException(
                    "Placement scope is invalid");
        }

        return new V1.ConsumerBinding
        {
            Placement = placement,
            ConsumerId = binding.ConsumerId.Value,
            Purpose = binding.Purpose.Value
        };
    }
}
