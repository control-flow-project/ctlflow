using System.Security.Cryptography;
using CtlFlow.Execution.Execd.Domain.Errors;
using CtlFlow.Execution.Execd.Domain.Resources;
using CtlFlow.Execution.Execd.Domain.Workloads;
using static CtlFlow.Execution.Execd.Domain.Workloads.Workloads;

namespace CtlFlow.Execution.Execd.Db.Workloads;

internal static partial class WorkloadRows
{
    internal static async ValueTask<
        IReadOnlyList<AdmittedDependency>>
        PrepareDependencies(
            IReadOnlyList<AdmittedDependency> requested,
            IReadOnlyList<AdmittedDependency> current,
            WorkloadWriteContent content,
            CancellationToken cancellation)
    {
        var options = content.DependencyOptions.ToDictionary(
            item => (item.ComponentId, item.DependencyName));
        if (options.Count != requested.Count)
        {
            throw new ExecutionException(
                ExecutionError.InvalidArgument,
                "Dependency options do not match the declaration");
        }

        foreach (var dependency in requested)
        {
            var key = (
                dependency.Selection.ComponentId,
                dependency.Selection.Name);
            if (!options.TryGetValue(key, out var payload))
            {
                throw new ExecutionException(
                    ExecutionError.InvalidArgument,
                    "Dependency options are missing");
            }

            ValidateOptions(dependency, payload.CanonicalJson.Span);
        }

        return await Domain.Workloads.Workloads.RetainDependencyState(
            requested,
            current,
            cancellation);
    }

    private static void ValidateOptions(
        AdmittedDependency dependency,
        ReadOnlySpan<byte> content)
    {
        if (content.Length != dependency.OptionsLength)
        {
            throw new ExecutionException(
                ExecutionError.InvalidArgument,
                "Dependency options length is invalid");
        }

        Span<byte> digest = stackalloc byte[SHA256.HashSizeInBytes];
        SHA256.HashData(content, digest);
        if (!Convert.ToHexString(digest)
                .ToLowerInvariant()
                .Equals(
                    dependency.OptionsSha256,
                    StringComparison.Ordinal))
        {
            throw new ExecutionException(
                ExecutionError.InvalidArgument,
                "Dependency options digest is invalid");
        }
    }
}
