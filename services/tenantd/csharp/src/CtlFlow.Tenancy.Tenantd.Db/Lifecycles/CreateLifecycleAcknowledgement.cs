using CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;

namespace CtlFlow.Tenancy.Tenantd.Db.Lifecycles;

public static partial class Lifecycles
{
    private static LifecycleAcknowledgement CreateLifecycleAcknowledgement(
        LifecycleStep step,
        AcceptedTargetState target) =>
        new(
            step.State,
            step.Revision,
            target.Lifecycle,
            target.ResourceRevision,
            target.ProvisioningGeneration);
}
