using CtlFlow.Execution.V1;
using CtlFlow.Policy.Policyd.Domain.Identifiers;
using CtlFlow.Policy.Policyd.Domain.Operations;
using CtlFlow.Policy.Policyd.Domain.Targets;

namespace CtlFlow.Policy.Policyd.Service.Decisions;

internal static partial class AccessDecisions
{
    // Boundary validation of the Execd resolver response: generated-message
    // defaults or a structurally impossible answer never reach the Placement
    // fence or the policy evaluator. A malformed response is dependency
    // unavailability, never caller input validation; the caller maps the
    // thrown InvalidDataException accordingly.
    private static ProductOperationBinding ValidateBindingResponse(
        ResolveWorkloadOperationBindingResponse response)
    {
        try
        {
            var target = response.EffectivePlacementTarget
                ?? throw new InvalidDataException(
                    "The resolver response has no Placement target");
            return new ProductOperationBinding(
                ReadContainment(target),
                AppId.Parse(response.AppId),
                PackageId.Parse(response.PackageId));
        }
        catch (ArgumentException failure)
        {
            throw new InvalidDataException(
                "The resolver response is invalid",
                failure);
        }
    }

    private static PlacementContainment ReadContainment(
        PlacementTarget target) =>
        target.LevelCase switch
        {
            PlacementTarget.LevelOneofCase.Global =>
                new PlacementContainment.Global(),
            PlacementTarget.LevelOneofCase.Tenant =>
                new PlacementContainment.Tenant(
                    TenantId.Parse(target.Tenant.TenantId)),
            PlacementTarget.LevelOneofCase.Workspace =>
                new PlacementContainment.Workspace(
                    TenantId.Parse(target.Workspace.TenantId),
                    WorkspaceId.Parse(target.Workspace.WorkspaceId)),
            PlacementTarget.LevelOneofCase.User =>
                new PlacementContainment.User(
                    TenantId.Parse(target.User.TenantId),
                    ReadAccount(target.User.AccountPrincipalId)),
            _ => throw new InvalidDataException(
                "The resolver Placement target level is invalid")
        };

    private static PrincipalId ReadAccount(string value)
    {
        var account = PrincipalId.Parse(value);
        if (account.Kind == PrincipalKind.Virtual)
        {
            throw new InvalidDataException(
                "The resolver account principal is invalid");
        }

        return account;
    }
}
