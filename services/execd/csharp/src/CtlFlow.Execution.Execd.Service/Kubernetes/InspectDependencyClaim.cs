using System.Text.Json;
using CtlFlow.Execution.Execd.Domain.Configuration;
using CtlFlow.Execution.Execd.Domain.Identifiers;
using CtlFlow.Execution.Execd.Domain.Resources;
using static CtlFlow.Execution.Execd.Service.Kubernetes.KubernetesJson;

namespace CtlFlow.Execution.Execd.Service.Kubernetes;

internal static partial class KubernetesApis
{
    internal static DependencyClaimStatus InspectDependencyClaim(
        JsonElement document,
        Revision claimRevision)
    {
        if (!document.TryGetProperty("status", out var status)
            || status.ValueKind == JsonValueKind.Null)
        {
            return new DependencyClaimStatus(
                0,
                DependencyBindingPhase.Pending,
                null,
                null,
                []);
        }

        if (status.ValueKind != JsonValueKind.Object)
        {
            throw InvalidStatus();
        }

        var observed = ReadRequiredPositiveInt64(
            status,
            "observedClaimRevision");
        if (observed > claimRevision.Value)
        {
            throw InvalidStatus();
        }

        var phase = ReadRequiredString(status, "phase", 16);
        if (observed < claimRevision.Value)
        {
            return new DependencyClaimStatus(
                observed,
                DependencyBindingPhase.Pending,
                null,
                null,
                []);
        }

        return phase switch
        {
            "pending" => new DependencyClaimStatus(
                observed,
                DependencyBindingPhase.Pending,
                null,
                null,
                []),
            "rejected" => new DependencyClaimStatus(
                observed,
                DependencyBindingPhase.Rejected,
                null,
                null,
                []),
            "ready" => ReadReady(status, observed),
            _ => throw InvalidStatus()
        };
    }

    private static DependencyClaimStatus ReadReady(
        JsonElement status,
        long observed)
    {
        var ready = ReadRequiredObject(status, "ready");
        var bindingId = BindingId.Parse(
            ReadRequiredString(ready, "bindingId", 128));
        var bindingRevision = Revision.Parse(
            checked((ulong)ReadRequiredPositiveInt64(
                ready,
                "bindingRevision")));
        if (!ready.TryGetProperty(
                "configdTargets",
                out var targets)
            || targets.ValueKind != JsonValueKind.Array
            || targets.GetArrayLength() > 64)
        {
            throw InvalidStatus();
        }

        var outputs = new List<ConfigTargetReference>(
            targets.GetArrayLength());
        foreach (var item in targets.EnumerateArray())
        {
            var purpose = Purpose.Parse(
                ReadRequiredString(item, "purpose", 64));
            var hasConfiguration =
                item.TryGetProperty("configuration", out var config);
            var hasSecret =
                item.TryGetProperty("secret", out var secret);
            if (hasConfiguration == hasSecret)
            {
                throw InvalidStatus();
            }

            outputs.Add(hasConfiguration
                ? new ConfigTargetReference.Configuration(
                    purpose,
                    ConfigurationId.Parse(ReadRequiredString(
                        config,
                        "configurationId",
                        64)),
                    VersionId.Parse(ReadRequiredString(
                        config,
                        "configurationVersionId",
                        64)))
                : new ConfigTargetReference.Secret(
                    purpose,
                    SecretId.Parse(ReadRequiredString(
                        secret,
                        "secretId",
                        64)),
                    VersionId.Parse(ReadRequiredString(
                        secret,
                        "secretVersionId",
                        64))));
        }

        if (outputs
                .Select(item => (item.Kind, item.Purpose))
                .Distinct()
                .Count() != outputs.Count)
        {
            throw InvalidStatus();
        }

        return new DependencyClaimStatus(
            observed,
            DependencyBindingPhase.Ready,
            bindingId,
            bindingRevision,
            outputs);
    }

    private static long ReadRequiredPositiveInt64(
        JsonElement parent,
        string property)
    {
        if (!parent.TryGetProperty(property, out var value)
            || value.ValueKind != JsonValueKind.Number
            || !value.TryGetInt64(out var number)
            || number <= 0)
        {
            throw InvalidStatus();
        }

        return number;
    }

    private static InvalidDataException InvalidStatus() =>
        new("DependencyClaim status is invalid");
}
