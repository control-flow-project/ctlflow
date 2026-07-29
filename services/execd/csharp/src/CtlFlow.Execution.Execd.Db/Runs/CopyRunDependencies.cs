using CtlFlow.Execution.Execd.Domain.Identifiers;
using CtlFlow.Execution.Execd.Domain.Runs;
using CtlFlow.Execution.Execd.Domain.Workloads;

namespace CtlFlow.Execution.Execd.Db.Runs;

internal static partial class RunRows
{
    internal static void CopyRunDependencies(
        ExecutionDbContext context,
        RunId runId,
        WorkloadRecord workload,
        IReadOnlyDictionary<
            (ComponentId ComponentId, DependencyName DependencyName),
            byte[]> options)
    {
        var run = runId.Value;
        context.RunDependencies.AddRange(
            workload.Dependencies.Select(item =>
            {
                var key = (
                    item.Selection.ComponentId,
                    item.Selection.Name);
                if (!options.TryGetValue(key, out var content))
                {
                    throw new InvalidOperationException(
                        "Run dependency options are incomplete");
                }

                return new RunDependency
                {
                    RunId = run,
                    ComponentId =
                        item.Selection.ComponentId.Value,
                    DependencyName = item.Selection.Name.Value,
                    DependencyId =
                        item.Selection.DependencyId?.Value,
                    DependencyType = item.Type.Value,
                    OptionsJson = content.ToArray(),
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
            }));

        context.RunDependencyParameters.AddRange(
            workload.Dependencies.SelectMany(dependency =>
                dependency.Selection.Parameters.Select(parameter =>
                    new RunDependencyParameter
                {
                    RunId = run,
                    ComponentId =
                        dependency.Selection.ComponentId.Value,
                    DependencyName =
                        dependency.Selection.Name.Value,
                    ParameterName = parameter.Name.Value,
                    DataKind = (int)parameter.Target.Target.Kind,
                    Purpose =
                        parameter.Target.Target.Purpose.Value,
                    TargetId =
                        parameter.Target.Target.TargetId,
                    TargetVersionId =
                        parameter.Target.Target.VersionId,
                    ProjectionId =
                        parameter.Target.ProjectionId?.Value
                        ?? throw new InvalidOperationException(
                            "Run parameter projection is unresolved"),
                    ProjectionRevision =
                        parameter.Target.ProjectionRevision?.Value
                        ?? throw new InvalidOperationException(
                            "Run parameter projection is unresolved")
                })));
        context.RunDependencyOutputs.AddRange(
            workload.Dependencies.SelectMany(dependency =>
                dependency.Outputs.Select(output =>
                    new RunDependencyOutput
                    {
                        RunId = run,
                        ComponentId =
                            dependency.Selection.ComponentId.Value,
                        DependencyName =
                            dependency.Selection.Name.Value,
                        DataKind = (int)output.Target.Kind,
                        Purpose = output.Target.Purpose.Value,
                        TargetId = output.Target.TargetId,
                        TargetVersionId = output.Target.VersionId,
                        ProjectionId = output.ProjectionId?.Value
                            ?? throw new InvalidOperationException(
                                "Run dependency output is unresolved"),
                        ProjectionRevision =
                            output.ProjectionRevision?.Value
                            ?? throw new InvalidOperationException(
                                "Run dependency output is unresolved")
                    })));
    }
}
