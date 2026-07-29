using CtlFlow.Execution.Execd.Domain.Resources;
using CtlFlow.Execution.Execd.Domain.Runs;
using CtlFlow.Execution.V1;
using Google.Protobuf.WellKnownTypes;
using DomainRunPhase =
    CtlFlow.Execution.Execd.Domain.Resources.RunPhase;
using DomainRunReason =
    CtlFlow.Execution.Execd.Domain.Resources.RunReason;
using WireRunPhase =
    CtlFlow.Execution.V1.RunPhase;
using WireRunReason =
    CtlFlow.Execution.V1.RunReason;
using WireRunExecutionSnapshot =
    CtlFlow.Execution.V1.RunExecutionSnapshot;
using DomainRunExecutionSnapshot =
    CtlFlow.Execution.Execd.Domain.Runs.RunExecutionSnapshot;
using WireAdmittedPackageComponent =
    CtlFlow.Execution.V1.AdmittedPackageComponent;
using WireRun = CtlFlow.Execution.V1.Run;

namespace CtlFlow.Execution.Execd.Service.Grpc.Responses;

internal static partial class ExecutionResponses
{
    internal static ValueTask<WireRun> CreateRunResponse(
        RunRecord run,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        var response = new WireRun
        {
            RunId = run.Id.Value,
            WorkloadId = run.WorkloadId.Value,
            WorkloadRevision = checked(
                (ulong)run.WorkloadRevision.Value),
            PlacementId = run.PlacementId.Value,
            Target = CreatePlacementTargetResponse(run.Target),
            Execution = CreateRunExecutionResponse(run.Execution),
            Phase = MapRunPhase(run.Phase),
            Reason = MapRunReason(run.Reason),
            AttemptCount = checked((uint)run.AttemptCount),
            Revision = checked((ulong)run.Revision.Value),
            CreatedAt = Timestamp.FromDateTimeOffset(
                run.CreatedAt.Value),
            UpdatedAt = Timestamp.FromDateTimeOffset(
                run.UpdatedAt.Value)
        };
        if (run.ActorPrincipalId is not null)
        {
            response.ActorPrincipalId = run.ActorPrincipalId.Value;
        }

        if (run.StartedAt is not null)
        {
            response.StartedAt = Timestamp.FromDateTimeOffset(
                run.StartedAt.Value);
        }

        if (run.CompletedAt is not null)
        {
            response.CompletedAt = Timestamp.FromDateTimeOffset(
                run.CompletedAt.Value);
        }

        return ValueTask.FromResult(response);
    }

    private static WireRunExecutionSnapshot CreateRunExecutionResponse(
        DomainRunExecutionSnapshot execution)
    {
        var response = new WireRunExecutionSnapshot
        {
            AdmittedPackageComponent =
                new WireAdmittedPackageComponent
                {
                    AppId = execution.AdmittedPackage.AppId.Value,
                    AppRevision = checked(
                        (ulong)execution.AdmittedPackage
                            .AppRevision.Value),
                    PackageId =
                        execution.AdmittedPackage.PackageId.Value,
                    PackageGeneration = checked(
                        (ulong)execution.AdmittedPackage
                            .PackageGeneration.Value),
                    ComponentId =
                        execution.AdmittedPackage.ComponentId.Value
                },
            Resources = CreateResourcesResponse(execution.Resources),
            RunDurationSeconds = checked(
                (ulong)execution.RunDurationSeconds),
            MaxAttempts = checked((uint)execution.MaxAttempts)
        };
        response.ConfigdTargets.AddRange(
            execution.ConfigTargets.Select(item =>
                CreateConfigTargetResponse(item.Target)));
        response.Dependencies.AddRange(
            execution.Dependencies.Select(item =>
                CreateDependencyResponse(item.Selection)));
        response.PersistentStorage.AddRange(
            execution.Storage.Select(CreateStorageResponse));
        return response;
    }

    private static WireRunPhase MapRunPhase(DomainRunPhase phase) =>
        phase switch
        {
            DomainRunPhase.Pending => WireRunPhase.Pending,
            DomainRunPhase.Starting => WireRunPhase.Starting,
            DomainRunPhase.Running => WireRunPhase.Running,
            DomainRunPhase.Cancelling => WireRunPhase.Cancelling,
            DomainRunPhase.Succeeded => WireRunPhase.Succeeded,
            DomainRunPhase.Failed => WireRunPhase.Failed,
            DomainRunPhase.Cancelled => WireRunPhase.Cancelled,
            _ => throw new InvalidOperationException(
                "Run phase is invalid")
        };

    private static WireRunReason MapRunReason(DomainRunReason reason) =>
        reason switch
        {
            DomainRunReason.None => WireRunReason.None,
            DomainRunReason.CancelRequested =>
                WireRunReason.CancelRequested,
            DomainRunReason.PlacementInactive =>
                WireRunReason.PlacementInactive,
            DomainRunReason.WorkloadInactive =>
                WireRunReason.WorkloadInactive,
            DomainRunReason.BindingUnavailable =>
                WireRunReason.BindingUnavailable,
            DomainRunReason.InvocationNotAdmitted =>
                WireRunReason.InvocationNotAdmitted,
            DomainRunReason.InvocationUnavailable =>
                WireRunReason.InvocationUnavailable,
            DomainRunReason.KubernetesUnavailable =>
                WireRunReason.KubernetesUnavailable,
            DomainRunReason.RealizationRejected =>
                WireRunReason.RealizationRejected,
            DomainRunReason.OwnershipConflict =>
                WireRunReason.OwnershipConflict,
            DomainRunReason.ExecutionFailed =>
                WireRunReason.ExecutionFailed,
            DomainRunReason.DurationExceeded =>
                WireRunReason.DurationExceeded,
            _ => throw new InvalidOperationException(
                "Run reason is invalid")
        };
}
