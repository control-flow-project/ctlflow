using System.Globalization;
using System.Text;
using Crossfire.Kernel;

namespace Crossfire.Domain;

public sealed record BackendWakeSender(string BackendUserId, bool IncludeAgents);
public sealed record CoordinationPolicy(string WakeMode, IReadOnlyList<BackendWakeSender> Senders, IReadOnlyList<string> Permissions);
public sealed record ControllerDescription(string Name, IReadOnlyDictionary<string, string> Metadata);
public sealed record RosterInstance(string InstanceKey, string Name, string? AgentId, CoordinationPolicy CoordinationPolicy, string? AccessToken = null);
public sealed record EnrollmentRoster(string OwnerBackendUserId, string FleetKey, ControllerDescription Controller, IReadOnlyList<RosterInstance> Instances, string? ControllerCredential = null);

public static class RosterValues
{
    private static readonly StringComparer Ordering = StringComparer.Create(CultureInfo.GetCultureInfo("en-US"), false);

    public static string Encode(EnrollmentRoster roster)
    {
        var output = new StringBuilder("{\"owner\":");
        ProtocolJson.String(output, roster.OwnerBackendUserId);
        output.Append(",\"fleet\":"); ProtocolJson.String(output, roster.FleetKey);
        output.Append(",\"controller\":{\"name\":"); ProtocolJson.String(output, roster.Controller.Name);
        output.Append(",\"metadata\":[");
        var position = 0;
        foreach (var entry in roster.Controller.Metadata.OrderBy(entry => entry.Key, Ordering))
        {
            if (position++ != 0) output.Append(',');
            output.Append('['); ProtocolJson.String(output, entry.Key); output.Append(','); ProtocolJson.String(output, entry.Value); output.Append(']');
        }
        output.Append("]},\"items\":["); position = 0;
        foreach (var instance in roster.Instances.OrderBy(instance => instance.InstanceKey, Ordering))
        {
            if (position++ != 0) output.Append(',');
            output.Append('['); ProtocolJson.String(output, instance.InstanceKey); output.Append(','); ProtocolJson.String(output, instance.Name);
            output.Append(','); if (instance.AgentId is null) output.Append("null"); else ProtocolJson.String(output, instance.AgentId);
            output.Append(",{\"wakeMode\":"); ProtocolJson.String(output, instance.CoordinationPolicy.WakeMode);
            output.Append(",\"senders\":["); var senderPosition = 0;
            foreach (var sender in instance.CoordinationPolicy.Senders.OrderBy(sender => sender.BackendUserId, Ordering))
            {
                if (senderPosition++ != 0) output.Append(',');
                output.Append("{\"backendUserId\":"); ProtocolJson.String(output, sender.BackendUserId);
                output.Append(",\"includeAgents\":").Append(sender.IncludeAgents ? "true" : "false").Append('}');
            }
            output.Append("],\"permissions\":["); var permissionPosition = 0;
            foreach (var permission in instance.CoordinationPolicy.Permissions.OrderBy(permission => permission, StringComparer.Ordinal))
            {
                if (permissionPosition++ != 0) output.Append(',');
                ProtocolJson.String(output, permission);
            }
            output.Append("]}]");
        }
        return output.Append("]}").ToString();
    }

    public static string Digest(EnrollmentRoster roster) => Identity.Hash(Encode(roster));
}
