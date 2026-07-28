using CtlFlow.Policy.Policyd.Domain.Targets;

namespace CtlFlow.Policy.Policyd.Db.Targets;

internal static partial class TargetKinds
{
    internal static int ToStorage(TargetKind value) =>
        value switch
        {
            (TargetKind)0 => 0,
            TargetKind.Tenant => 1,
            TargetKind.Workspace => 2,
            _ => throw new InvalidOperationException("Unknown target kind")
        };

    internal static TargetKind FromStorage(int value) =>
        value switch
        {
            1 => TargetKind.Tenant,
            2 => TargetKind.Workspace,
            _ => throw new InvalidOperationException(
                "Stored target kind is invalid")
        };
}
