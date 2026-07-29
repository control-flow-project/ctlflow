using CtlFlow.Execution.Execd.Domain.Configuration;
using CtlFlow.Execution.Execd.Domain.Workloads;

namespace CtlFlow.Execution.Execd.Domain.Workloads;

public static partial class Workloads
{
    internal static bool HasSameDeclaration(
        WorkloadRecord current,
        WorkloadDraft requested) =>
        current.PlacementId == requested.PlacementId
        && current.DesiredState == requested.DesiredState
        && current.PackageComponent == requested.PackageComponent
        && current.Resources == requested.Resources
        && current.AdmittedPackage == requested.AdmittedPackage
        && SameConfigTargets(
            current.ConfigTargets,
            requested.ConfigTargets)
        && SameDependencies(
            current.Dependencies,
            requested.Dependencies)
        && current.Storage.SequenceEqual(requested.Storage)
        && SameBehavior(current.Behavior, requested.Behavior)
        && SameInterfaces(current.Interfaces, requested.Interfaces);

    internal static bool HasSameDependencyDeclaration(
        AdmittedDependency current,
        AdmittedDependency requested) =>
        current.Selection.ComponentId
            == requested.Selection.ComponentId
        && current.Selection.Name == requested.Selection.Name
        && current.Selection.DependencyId
            == requested.Selection.DependencyId
        && current.Type == requested.Type
        && current.OptionsLength == requested.OptionsLength
        && current.OptionsSha256 == requested.OptionsSha256
        && current.ProvisionerId == requested.ProvisionerId
        && current.ProvisionerSubject
            == requested.ProvisionerSubject
        && current.ClaimId == requested.ClaimId
        && SameParameters(
            current.Selection.Parameters,
            requested.Selection.Parameters);

    private static bool SameConfigTargets(
        IReadOnlyList<ResolvedConfigTarget> left,
        IReadOnlyList<ResolvedConfigTarget> right) =>
        left.Count == right.Count
        && left.OrderBy(TargetKey)
            .SequenceEqual(right.OrderBy(TargetKey));

    private static bool SameDependencies(
        IReadOnlyList<AdmittedDependency> left,
        IReadOnlyList<AdmittedDependency> right)
    {
        if (left.Count != right.Count)
        {
            return false;
        }

        var orderedLeft = left.OrderBy(DependencyKey).ToArray();
        var orderedRight = right.OrderBy(DependencyKey).ToArray();
        for (var index = 0; index < orderedLeft.Length; index++)
        {
            if (!HasSameDependencyDeclaration(
                    orderedLeft[index],
                    orderedRight[index]))
            {
                return false;
            }
        }

        return true;
    }

    private static bool SameParameters(
        IReadOnlyList<ProvisioningParameter> left,
        IReadOnlyList<ProvisioningParameter> right) =>
        left.Count == right.Count
        && left.OrderBy(item => item.Name.Value)
            .SequenceEqual(right.OrderBy(item => item.Name.Value));

    private static bool SameBehavior(
        WorkloadBehavior left,
        WorkloadBehavior right) =>
        (left, right) switch
        {
            (
                WorkloadBehavior.Continuous first,
                WorkloadBehavior.Continuous second) =>
                first.Replicas == second.Replicas
                && first.InterfaceIds.SequenceEqual(
                    second.InterfaceIds),
            (
                WorkloadBehavior.Finite first,
                WorkloadBehavior.Finite second) =>
                first.ActorPrincipalId
                    == second.ActorPrincipalId
                && first.RunDurationSeconds
                    == second.RunDurationSeconds
                && first.MaxAttempts == second.MaxAttempts,
            _ => false
        };

    private static bool SameInterfaces(
        IReadOnlyList<AdmittedInterface> left,
        IReadOnlyList<AdmittedInterface> right) =>
        left.Count == right.Count
        && left.OrderBy(item => item.InterfaceId.Value)
            .Select(StaticInterface)
            .SequenceEqual(
                right.OrderBy(item => item.InterfaceId.Value)
                    .Select(StaticInterface));

    private static object StaticInterface(
        AdmittedInterface value) =>
        new
        {
            value.InterfaceId,
            value.Protocol,
            value.ContractId,
            value.Port,
            value.ExposureId
        };

    private static string TargetKey(ResolvedConfigTarget value) =>
        $"{(int)value.Target.Kind}\0{value.Target.Purpose.Value}";

    private static string DependencyKey(AdmittedDependency value) =>
        $"{value.Selection.ComponentId.Value}\0"
        + value.Selection.Name.Value;
}
