using CtlFlow.Execution.Execd.Domain.Configuration;
using CtlFlow.Execution.Execd.Domain.Identifiers;
using CtlFlow.Execution.Execd.Domain.Resources;
using CtlFlow.Execution.Execd.Domain.Runs;
using CtlFlow.Execution.Execd.Domain.Workloads;

namespace CtlFlow.Execution.Execd.Db.Workloads;

internal static partial class WorkloadRows
{
    internal static ResolvedConfigTarget MapConfigTarget(
        int dataKind,
        string purpose,
        string targetId,
        string targetVersionId,
        string? projectionId,
        long? projectionRevision)
    {
        var parsedPurpose = Purpose.Parse(purpose);
        ConfigTargetReference target = dataKind switch
        {
            (int)DataKind.Configuration =>
                new ConfigTargetReference.Configuration(
                    parsedPurpose,
                    ConfigurationId.Parse(targetId),
                    VersionId.Parse(targetVersionId)),
            (int)DataKind.Secret =>
                new ConfigTargetReference.Secret(
                    parsedPurpose,
                    SecretId.Parse(targetId),
                    VersionId.Parse(targetVersionId)),
            _ => throw new InvalidOperationException(
                "Stored Configd target kind is invalid")
        };
        if ((projectionId is null) != (projectionRevision is null))
        {
            throw new InvalidOperationException(
                "Stored Configd projection is incomplete");
        }

        return new ResolvedConfigTarget(
            target,
            projectionId is null
                ? null
                : ProjectionId.Parse(projectionId),
            projectionRevision is null
                ? null
                : Revision.FromStorage(projectionRevision.Value));
    }

    internal static ResolvedConfigTarget MapConfigTarget(
        WorkloadConfigTarget row) =>
        MapConfigTarget(
            row.DataKind,
            row.Purpose,
            row.TargetId,
            row.TargetVersionId,
            row.ProjectionId,
            row.ProjectionRevision);

    internal static ResolvedConfigTarget MapConfigTarget(
        WorkloadDependencyParameter row) =>
        MapConfigTarget(
            row.DataKind,
            row.Purpose,
            row.TargetId,
            row.TargetVersionId,
            row.ProjectionId,
            row.ProjectionRevision);

    internal static ResolvedConfigTarget MapConfigTarget(
        WorkloadDependencyOutput row) =>
        MapConfigTarget(
            row.DataKind,
            row.Purpose,
            row.TargetId,
            row.TargetVersionId,
            row.ProjectionId,
            row.ProjectionRevision);

    internal static ResolvedConfigTarget MapConfigTarget(
        RunConfigTarget row) =>
        MapConfigTarget(
            row.DataKind,
            row.Purpose,
            row.TargetId,
            row.TargetVersionId,
            row.ProjectionId,
            row.ProjectionRevision);

    internal static ResolvedConfigTarget MapConfigTarget(
        RunDependencyParameter row) =>
        MapConfigTarget(
            row.DataKind,
            row.Purpose,
            row.TargetId,
            row.TargetVersionId,
            row.ProjectionId,
            row.ProjectionRevision);

    internal static ResolvedConfigTarget MapConfigTarget(
        RunDependencyOutput row) =>
        MapConfigTarget(
            row.DataKind,
            row.Purpose,
            row.TargetId,
            row.TargetVersionId,
            row.ProjectionId,
            row.ProjectionRevision);
}
