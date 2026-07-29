using CtlFlow.Execution.Execd.Domain.Configuration;
using CtlFlow.Execution.Execd.Domain.Errors;
using CtlFlow.Execution.Execd.Domain.Identifiers;
using CtlFlow.Execution.Execd.Domain.Placements;
using CtlFlow.Execution.Execd.Domain.Resources;

namespace CtlFlow.Execution.Execd.Domain.Workloads;

public static partial class Workloads
{
    public static ValueTask<WorkloadDraft> AdmitWorkload(
        PlacementRecord placement,
        WorkloadRequest requested,
        PackageAdmission package,
        IReadOnlyList<InstalledProvisioner> installedProvisioners,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (package.App.PlacementId != placement.Id
            || package.App.Scope != placement.Target)
        {
            throw new ExecutionException(
                ExecutionError.NotFound,
                "App was not found");
        }

        var component = package.Components.SingleOrDefault(
            item => item.ComponentId
                == requested.PackageComponent.ComponentId)
            ?? throw new ExecutionException(
                ExecutionError.NotFound,
                "Package component was not found");
        var dependencies = AdmitPackageDependencies(
            placement,
            requested,
            package,
            installedProvisioners);
        var interfaces = AdmitPackageInterfaces(
            placement.Target,
            requested,
            package);
        return ValueTask.FromResult(new WorkloadDraft(
            requested.Id,
            requested.PlacementId,
            requested.DesiredState,
            requested.PackageComponent,
            requested.Resources,
            requested.ConfigTargets.Select(item =>
                new ResolvedConfigTarget(
                    item,
                    null,
                    null)).ToArray(),
            dependencies,
            requested.Storage,
            requested.Behavior,
            new AdmittedPackageComponent(
                requested.PackageComponent.AppId,
                package.App.AppRevision,
                package.App.PackageId,
                package.App.PackageGeneration,
                component.ComponentId,
                component.ArtifactRepository,
                component.ArtifactManifestDigest),
            interfaces));
    }

    private static IReadOnlyList<AdmittedDependency>
        AdmitPackageDependencies(
            PlacementRecord placement,
            WorkloadRequest requested,
            PackageAdmission package,
            IReadOnlyList<InstalledProvisioner> installedProvisioners)
    {
        Dictionary<DependencyName, PackageDependencyAdmission> declared;
        Dictionary<DependencyType, Identifiers.ProvisionerId> admitted;
        Dictionary<Identifiers.ProvisionerId, ProvisionerSubject> installed;
        try
        {
            declared = package.Dependencies
                .Where(item => item.ComponentId
                    == requested.PackageComponent.ComponentId)
                .ToDictionary(item => item.Name);
            admitted = placement.Constraints.Provisioners.ToDictionary(
                item => item.DependencyType,
                item => item.ProvisionerId);
            installed = installedProvisioners.ToDictionary(
                item => item.ProvisionerId,
                item => item.Subject);
        }
        catch (ArgumentException)
        {
            throw InvalidPackageAdmission();
        }

        if (declared.Count != requested.Dependencies.Count
            || requested.Dependencies
                .Select(item => item.Name)
                .Distinct()
                .Count() != requested.Dependencies.Count)
        {
            throw PackageAdmissionFailed(
                "Every Package dependency requires one selection");
        }

        return requested.Dependencies.Select(selection =>
        {
            if (!declared.TryGetValue(
                    selection.Name,
                    out var dependency)
                || dependency.ComponentId != selection.ComponentId
                || dependency.DependencyId != selection.DependencyId)
            {
                throw PackageAdmissionFailed(
                    "Dependency selection does not match the Package");
            }

            if (!admitted.TryGetValue(
                    dependency.Type,
                    out var provisionerId)
                || !installed.TryGetValue(
                    provisionerId,
                    out var provisionerSubject))
            {
                throw PackageAdmissionFailed(
                    "Dependency type has no admitted provisioner");
            }

            return new AdmittedDependency(
                new DependencySelection(
                    selection.ComponentId,
                    selection.Name,
                    selection.DependencyId,
                    selection.Parameters.Select(parameter =>
                        new ProvisioningParameter(
                            parameter.Name,
                            new ResolvedConfigTarget(
                                parameter.Target,
                                null,
                                null))).ToArray()),
                dependency.Type,
                dependency.OptionsLength,
                dependency.OptionsSha256,
                provisionerId,
                provisionerSubject,
                CreateDependencyClaimId(
                    requested.Id,
                    selection.ComponentId,
                    selection.Name),
                Revision.Initial(),
                0,
                DependencyBindingPhase.Pending,
                null,
                null,
                []);
        }).ToArray();
    }

    private static IReadOnlyList<AdmittedInterface>
        AdmitPackageInterfaces(
            PlacementTarget target,
            WorkloadRequest requested,
            PackageAdmission package)
    {
        if (requested.Behavior is not
            WorkloadBehavior.Continuous continuous)
        {
            return [];
        }

        Dictionary<Identifiers.InterfaceId, PackageInterfaceAdmission>
            interfaces;
        Dictionary<Identifiers.InterfaceId, PackageExposureAdmission>
            exposures;
        try
        {
            interfaces = package.Interfaces
                .Where(item => item.ComponentId
                    == requested.PackageComponent.ComponentId)
                .ToDictionary(item => item.InterfaceId);
            exposures = package.Exposures.ToDictionary(
                item => item.InterfaceId);
        }
        catch (ArgumentException)
        {
            throw InvalidPackageAdmission();
        }

        return continuous.InterfaceIds.Select(interfaceId =>
        {
            if (!interfaces.TryGetValue(
                    interfaceId,
                    out var declared))
            {
                throw PackageAdmissionFailed(
                    "Selected interface is not declared by the component");
            }

            Identifiers.ExposureId? exposureId = null;
            if (exposures.TryGetValue(interfaceId, out var exposure))
            {
                if (declared.Protocol != InterfaceProtocol.Http
                    || target is not (
                        PlacementTarget.Tenant
                        or PlacementTarget.Workspace))
                {
                    throw PackageAdmissionFailed(
                        "Public exposure is not admitted for this Workload");
                }

                exposureId = exposure.ExposureId;
            }

            return new AdmittedInterface(
                interfaceId,
                declared.Protocol,
                declared.ContractId,
                declared.Port,
                exposureId,
                null,
                false);
        }).ToArray();
    }

    private static ExecutionException PackageAdmissionFailed(
        string message) =>
        new(ExecutionError.FailedPrecondition, message);

    private static ExecutionException InvalidPackageAdmission() =>
        new(
            ExecutionError.Unavailable,
            "Pkgd returned an invalid Package");
}
