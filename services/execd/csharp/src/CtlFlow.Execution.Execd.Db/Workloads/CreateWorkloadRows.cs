using CtlFlow.Execution.Execd.Db.Persistence;
using CtlFlow.Execution.Execd.Domain.Configuration;
using CtlFlow.Execution.Execd.Domain.Workloads;

namespace CtlFlow.Execution.Execd.Db.Workloads;

internal static partial class WorkloadRows
{
    internal static WorkloadConfigTarget[] CreateConfigTargetRows(
        WorkloadDraft draft) =>
        draft.ConfigTargets.Select(item => new WorkloadConfigTarget
        {
            WorkloadId = draft.Id.Value,
            DataKind = (int)item.Target.Kind,
            Purpose = item.Target.Purpose.Value,
            TargetId = item.Target.TargetId,
            TargetVersionId = item.Target.VersionId,
            ProjectionId = item.ProjectionId?.Value,
            ProjectionRevision = item.ProjectionRevision?.Value
        }).ToArray();

    internal static WorkloadDependency[]
        CreateDependencyRows(
            WorkloadDraft draft,
            WorkloadWriteContent content)
    {
        var options = content.DependencyOptions.ToDictionary(
            item => (item.ComponentId, item.DependencyName));
        return draft.Dependencies.Select(item =>
        {
            var key = (
                item.Selection.ComponentId,
                item.Selection.Name);
            return new WorkloadDependency
            {
                WorkloadId = draft.Id.Value,
                ComponentId =
                    item.Selection.ComponentId.Value,
                DependencyName =
                    item.Selection.Name.Value,
                DependencyId =
                    item.Selection.DependencyId?.Value,
                DependencyType = item.Type.Value,
                OptionsJson =
                    options[key].CanonicalJson.ToArray(),
                OptionsLength = item.OptionsLength,
                OptionsSha256 = item.OptionsSha256,
                ProvisionerId = item.ProvisionerId.Value,
                ProvisionerSubject =
                    item.ProvisionerSubject.Value,
                ClaimId = item.ClaimId,
                ClaimRevision = item.ClaimRevision.Value,
                BindingId = item.BindingId?.Value,
                BindingRevision = item.BindingRevision?.Value,
                ObservedClaimRevision =
                    item.ObservedClaimRevision,
                BindingPhase = (int)item.BindingPhase
            };
        }).ToArray();
    }

    internal static WorkloadDependencyParameter[]
        CreateParameterRows(WorkloadDraft draft) =>
        draft.Dependencies.SelectMany(dependency =>
            dependency.Selection.Parameters.Select(parameter =>
                new WorkloadDependencyParameter
                {
                    WorkloadId = draft.Id.Value,
                    ComponentId = dependency.Selection
                        .ComponentId.Value,
                    DependencyName =
                        dependency.Selection.Name.Value,
                    ParameterName = parameter.Name.Value,
                    DataKind =
                        (int)parameter.Target.Target.Kind,
                    Purpose = parameter.Target.Target
                        .Purpose.Value,
                    TargetId =
                        parameter.Target.Target.TargetId,
                    TargetVersionId =
                        parameter.Target.Target.VersionId,
                    ProjectionId =
                        parameter.Target.ProjectionId?.Value,
                    ProjectionRevision =
                        parameter.Target.ProjectionRevision?.Value
                })).ToArray();

    internal static WorkloadDependencyOutput[]
        CreateOutputRows(WorkloadDraft draft) =>
        draft.Dependencies.SelectMany(dependency =>
            dependency.Outputs.Select(output =>
                new WorkloadDependencyOutput
                {
                    WorkloadId = draft.Id.Value,
                    ComponentId = dependency.Selection
                        .ComponentId.Value,
                    DependencyName =
                        dependency.Selection.Name.Value,
                    DataKind = (int)output.Target.Kind,
                    Purpose = output.Target.Purpose.Value,
                    TargetId = output.Target.TargetId,
                    TargetVersionId =
                        output.Target.VersionId,
                    ProjectionId =
                        output.ProjectionId?.Value,
                    ProjectionRevision =
                        output.ProjectionRevision?.Value
                })).ToArray();

    internal static WorkloadStorage[] CreateStorageRows(
        WorkloadDraft draft) =>
        draft.Storage.Select(item => new WorkloadStorage
        {
            WorkloadId = draft.Id.Value,
            StorageId = item.StorageId.Value,
            MountPath = item.MountPath.Value,
            CapacityBytes = item.CapacityBytes
        }).ToArray();

    internal static WorkloadInterface[] CreateInterfaceRows(
        WorkloadDraft draft) =>
        draft.Interfaces.Select(item =>
            new WorkloadInterface
            {
                WorkloadId = draft.Id.Value,
                InterfaceId = item.InterfaceId.Value,
                Protocol = (int)item.Protocol,
                ContractId = item.ContractId.Value,
                Port = item.Port,
                ExposureId = item.ExposureId?.Value,
                EndpointHost = item.Host?.Value,
                Ready = item.Ready
            }).ToArray();
}
