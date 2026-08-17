using CtlFlow.Execution.Execd.Domain.Runs;
using CtlFlow.Execution.Execd.Domain.Workloads;

namespace CtlFlow.Execution.Execd.Db.Runs;

internal static partial class RunRows
{
    internal static RunConfigTarget[] CreateConfigTargets(
        Domain.Identifiers.RunId runId,
        WorkloadRecord workload) =>
        workload.ConfigTargets.Select(target =>
            new RunConfigTarget
            {
                RunId = runId.Value,
                DataKind = (int)target.Target.Kind,
                Purpose = target.Target.Purpose.Value,
                TargetId = target.Target.TargetId,
                TargetVersionId = target.Target.VersionId,
                ProjectionId =
                    target.ProjectionId?.Value,
                ProjectionRevision =
                    target.ProjectionRevision?.Value
            }).ToArray();

    internal static RunStorage[] CreateStorage(
        Domain.Identifiers.RunId runId,
        WorkloadRecord workload) =>
        workload.Storage.Select(item => new RunStorage
        {
            RunId = runId.Value,
            PlacementId = workload.PlacementId.Value,
            AppId = workload.AdmittedPackage.AppId.Value,
            StorageId = item.StorageId.Value,
            MountPath = item.MountPath.Value
        }).ToArray();
}
