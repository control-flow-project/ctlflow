using CtlFlow.Execution.Execd.Domain.Identifiers;
using CtlFlow.Execution.Execd.Domain.Placements;
using CtlFlow.Execution.Execd.Domain.Resources;
using CtlFlow.Execution.Execd.Service.Configuration;
using CtlFlow.Execution.V1;
using static CtlFlow.Execution.Execd.Service.Grpc.Requests.ExecutionRequests;
using DomainWorkloadMode =
    CtlFlow.Execution.Execd.Domain.Resources.WorkloadMode;
using DomainDependencyProvisionerSelection =
    CtlFlow.Execution.Execd.Domain.Placements.DependencyProvisionerSelection;
using DomainPlacementConstraints =
    CtlFlow.Execution.Execd.Domain.Placements.PlacementConstraints;

namespace CtlFlow.Execution.Execd.Service.Grpc.Requests;

internal static partial class ExecutionRequests
{
    internal static async ValueTask<PlacementDraft> CreatePlacementDraft(
        DeclarePlacementRequest request,
        ProvisionerSettings provisioners,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        var target = await ParsePlacementTarget(
            request.Target,
            cancellation);
        var input = request.Constraints
            ?? throw new ArgumentException("constraints is required");
        if (input.AdmittedModes.Count is < 1 or > 2
            || input.AdmittedModes.Distinct().Count()
                != input.AdmittedModes.Count
            || input.AdmittedModes.Any(mode =>
                mode is not (
                    CtlFlow.Execution.V1.WorkloadMode.Continuous
                    or CtlFlow.Execution.V1.WorkloadMode.Finite)))
        {
            throw new ArgumentException(
                "admitted_modes is invalid");
        }

        var selections = new List<
            DomainDependencyProvisionerSelection>(
            input.DependencyProvisioners.Count);
        foreach (var selection in input.DependencyProvisioners)
        {
            var provisionerId = ProvisionerId.Parse(
                selection.ProvisionerId);
            if (!provisioners.Subjects.ContainsKey(provisionerId))
            {
                throw new ArgumentException(
                    "dependency provisioner is not installed");
            }

            selections.Add(new DomainDependencyProvisionerSelection(
                DependencyType.Parse(selection.DependencyTypeId),
                provisionerId));
        }

        var resources = input.MaxResourcesPerExecution
            ?? throw new ArgumentException(
                "max_resources_per_execution is required");
        return new PlacementDraft(
            PlacementId.Parse(request.PlacementId),
            target,
            request.HasParentPlacementId
                ? PlacementId.Parse(request.ParentPlacementId)
                : null,
            DomainPlacementConstraints.Create(
                input.AdmittedModes.Contains(
                    CtlFlow.Execution.V1.WorkloadMode.Continuous),
                input.AdmittedModes.Contains(
                    CtlFlow.Execution.V1.WorkloadMode.Finite),
                input.MaxReplicasPerContinuousWorkload,
                input.MaxRunDurationSeconds,
                input.MaxRunAttempts,
                resources.CpuMillis,
                resources.MemoryBytes,
                input.MaxPersistentStorageBytesPerWorkload,
                selections),
            ParseDesiredState(request.DesiredState),
            request.HasExpectedRevision
                ? Revision.Parse(request.ExpectedRevision)
                : null);
    }
}
