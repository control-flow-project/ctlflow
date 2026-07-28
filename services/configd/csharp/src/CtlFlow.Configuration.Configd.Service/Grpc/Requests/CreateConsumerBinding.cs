using CtlFlow.Configuration.Configd.Domain.Bindings;
using CtlFlow.Configuration.Configd.Domain.Identifiers;
using WireConsumerBinding = CtlFlow.Configuration.V1.ConsumerBinding;
using WirePlacementBinding = CtlFlow.Configuration.V1.PlacementBinding;

namespace CtlFlow.Configuration.Configd.Service.Grpc.Requests;

internal static partial class ConfigdRequests
{
    internal static ValueTask<ConsumerBinding> CreateConsumerBinding(
        WireConsumerBinding? value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (value?.Placement is null)
        {
            throw new ArgumentException("Consumer binding is required");
        }

        var placementId = PlacementId.Parse(value.Placement.PlacementId);
        PlacementScope scope = value.Placement.ScopeCase switch
        {
            WirePlacementBinding.ScopeOneofCase.Global
                when value.Placement.Global is not null =>
                new PlacementScope.Global(),
            WirePlacementBinding.ScopeOneofCase.Tenant
                when value.Placement.Tenant is not null =>
                new PlacementScope.Tenant(
                    TenantId.Parse(value.Placement.Tenant.TenantId)),
            WirePlacementBinding.ScopeOneofCase.Workspace
                when value.Placement.Workspace is not null =>
                new PlacementScope.Workspace(
                    TenantId.Parse(
                        value.Placement.Workspace.TenantId),
                    WorkspaceId.Parse(
                        value.Placement.Workspace.WorkspaceId)),
            WirePlacementBinding.ScopeOneofCase.User
                when value.Placement.User is not null =>
                new PlacementScope.User(
                    TenantId.Parse(value.Placement.User.TenantId),
                    AccountPrincipalId.Parse(
                        value.Placement.User.AccountPrincipalId)),
            _ => throw new ArgumentException(
                "Exactly one Placement scope is required")
        };
        return ValueTask.FromResult(new ConsumerBinding(
            new PlacementBinding(placementId, scope),
            ConsumerId.Parse(value.ConsumerId),
            Purpose.Parse(value.Purpose)));
    }
}
