using CtlFlow.Execution.Execd.Domain.Identifiers;

namespace CtlFlow.Execution.Execd.Domain.Naming;

public static partial class NativeNames
{
    public static string CreatePlacementNamespace(PlacementId placementId) =>
        $"plc-{CreateNativeToken(
            "ctlflow.execution.v1.PlacementNamespace",
            placementId.Value)}";
}
