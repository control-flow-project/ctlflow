using System.Globalization;
using System.Text.Json;
using CtlFlow.Execution.Execd.Domain.Resources;
using CtlFlow.Execution.Execd.Domain.Time;

namespace CtlFlow.Execution.Execd.Service.Kubernetes;

internal static partial class KubernetesApis
{
    internal static JobStatus InspectJob(
        JsonElement document,
        int maximumAttempts)
    {
        if (!document.TryGetProperty("status", out var status)
            || status.ValueKind is JsonValueKind.Null
                or JsonValueKind.Undefined)
        {
            return new JobStatus(
                RunPhase.Starting,
                RunReason.None,
                0,
                null,
                null);
        }

        if (status.ValueKind != JsonValueKind.Object)
        {
            throw InvalidJobStatus();
        }

        var active = ReadCount(status, "active");
        var succeeded = ReadCount(status, "succeeded");
        var failed = ReadCount(status, "failed");
        var startedAt = ReadInstant(status, "startTime");
        var completedAt = ReadInstant(status, "completionTime");
        if (succeeded > 0)
        {
            return new JobStatus(
                RunPhase.Succeeded,
                RunReason.None,
                checked(failed + succeeded),
                startedAt,
                completedAt);
        }

        if (IsFailed(status) || failed >= maximumAttempts)
        {
            return new JobStatus(
                RunPhase.Failed,
                IsDurationExceeded(status)
                    ? RunReason.DurationExceeded
                    : RunReason.ExecutionFailed,
                failed,
                startedAt,
                completedAt);
        }

        return new JobStatus(
            active > 0 ? RunPhase.Running : RunPhase.Starting,
            RunReason.None,
            checked(failed + active),
            startedAt,
            null);
    }

    private static int ReadCount(
        JsonElement status,
        string property)
    {
        if (!status.TryGetProperty(property, out var value))
        {
            return 0;
        }

        if (value.ValueKind != JsonValueKind.Number
            || !value.TryGetInt32(out var count)
            || count < 0)
        {
            throw InvalidJobStatus();
        }

        return count;
    }

    private static UtcInstant? ReadInstant(
        JsonElement status,
        string property)
    {
        if (!status.TryGetProperty(property, out var value))
        {
            return null;
        }

        if (value.ValueKind != JsonValueKind.String
            || !DateTimeOffset.TryParse(
                value.GetString(),
                CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal
                    | DateTimeStyles.AdjustToUniversal,
                out var instant))
        {
            throw InvalidJobStatus();
        }

        return UtcInstant.FromStorage(
            instant.ToUnixTimeMilliseconds());
    }

    private static bool IsFailed(JsonElement status) =>
        ReadConditions(status).Any(item =>
            HasCondition(item, "Failed"));

    private static bool IsDurationExceeded(JsonElement status) =>
        ReadConditions(status).Any(item =>
            HasCondition(item, "Failed")
            && item.TryGetProperty("reason", out var reason)
            && reason.ValueKind == JsonValueKind.String
            && string.Equals(
                reason.GetString(),
                "DeadlineExceeded",
                StringComparison.Ordinal));

    private static IEnumerable<JsonElement> ReadConditions(
        JsonElement status)
    {
        if (!status.TryGetProperty("conditions", out var conditions))
        {
            return [];
        }

        if (conditions.ValueKind != JsonValueKind.Array
            || conditions.GetArrayLength() > 32)
        {
            throw InvalidJobStatus();
        }

        return conditions.EnumerateArray().Select(item => item.Clone());
    }

    private static bool HasCondition(
        JsonElement condition,
        string expectedType) =>
        condition.ValueKind == JsonValueKind.Object
        && condition.TryGetProperty("type", out var type)
        && type.ValueKind == JsonValueKind.String
        && string.Equals(
            type.GetString(),
            expectedType,
            StringComparison.Ordinal)
        && condition.TryGetProperty("status", out var status)
        && status.ValueKind == JsonValueKind.String
        && string.Equals(
            status.GetString(),
            "True",
            StringComparison.Ordinal);

    private static InvalidDataException InvalidJobStatus() =>
        new("Job status is invalid");
}
